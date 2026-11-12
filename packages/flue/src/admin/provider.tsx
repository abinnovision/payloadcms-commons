"use client";

import {
	toast,
	useAuth,
	useConfig,
	useHotkey,
	usePreferences,
} from "@payloadcms/ui";
import React, {
	createContext,
	lazy,
	Suspense,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";

import { errorText, flueApi, isRun } from "./api.js";
import { DocumentRegistryContext, documentRegistry } from "./document.js";
import { PANEL_ID, PANEL_WIDTH, clampWidth } from "./layout.js";
import { PANEL_CSS } from "./styles.js";

import type { AgentSummary } from "./api.js";
import type { PanelView } from "./panel.js";
import type { AttachmentLimits } from "../protocol/attachments.js";

export interface FlueProviderProps {
	children?: React.ReactNode;
	/** The plugin's `endpointPath`. */
	endpointPath: string;
	threadsSlug: string;
	/** mcpx's user collection, the only one whose users chat. */
	userCollection: string;
	/** mcpx's endpoint path, where calls waiting for approval are decided. */
	mcpxEndpointPath: string;
}

/** What the toggle reads. */
export interface FlueState {
	open: boolean;
	toggle: () => void;
	agents: AgentSummary[];
	/** The user may read agent runs. */
	runs: boolean;
	/** The open thread has a run in progress. */
	running: boolean;
}

/** The `flue` preference, which brings the panel back after a reload. */
interface FluePreference {
	open: boolean;
	agent: null | string;
	threadId: null | string;
	width: number;
}

const PREFERENCE_KEY = "flue";

// Ctrl or Cmd plus J. Payload's command palette has K.
const HOTKEY = ["j"];

const FlueContext = createContext<FlueState | null>(null);

// The chat, with the runtime, the panel and Markdown, loads once a user can chat.
const FlueChat = lazy(async () => ({
	default: (await import("./chat.js")).FlueChat,
}));

/** The chat state, or null before sign-in and outside the provider. */
export const useFlue = (): FlueState | null => useContext(FlueContext);

/**
 * Owns the agent chat for the whole admin and docks its panel next to it.
 * Mounted through `admin.components.providers`, which also wrap the login
 * view. The admin renders inside the same element whoever is signed in, and
 * nothing is requested until a user of the mcpx user collection is.
 */
export const FlueProvider: React.FC<FlueProviderProps> = ({
	children,
	endpointPath,
	mcpxEndpointPath,
	threadsSlug,
	userCollection,
}) => {
	const { user } = useAuth();
	const { config } = useConfig();
	const { getPreference, setPreference } = usePreferences();
	// Keyed by id, so signing in as someone else starts from scratch.
	const userId = user?.collection === userCollection ? user.id : undefined;
	const userKey = userId === undefined ? undefined : String(userId);
	const api = useMemo(
		() =>
			flueApi({
				serverURL: config.serverURL,
				apiRoute: config.routes.api,
				endpointPath,
				threadsSlug,
				mcpxEndpointPath,
			}),
		[
			config.serverURL,
			config.routes.api,
			endpointPath,
			threadsSlug,
			mcpxEndpointPath,
		],
	);

	// Where the open edit view's bridge registers its document.
	const [registry] = useState(documentRegistry);
	// The user the state below was restored for.
	const [loadedFor, setLoadedFor] = useState<string>();
	const [open, setOpen] = useState(false);
	const [agents, setAgents] = useState<AgentSummary[]>([]);
	// Every agent, when the user may read agent runs.
	const [runAgents, setRunAgents] = useState<AgentSummary[]>();
	// The limits of chat attachments; null while they are off.
	const [attachments, setAttachments] = useState<AttachmentLimits | null>(null);
	const [agent, setAgent] = useState<string>();
	const [threadId, setThreadId] = useState<string>();
	// The user opened the thread, which a document's own thread then leaves open.
	const [chosen, setChosen] = useState(false);
	const [view, setView] = useState<PanelView>("conversation");
	const [running, setRunning] = useState(false);
	// The width while dragging, and the one kept once a resize ends.
	const [width, setWidth] = useState<number>(PANEL_WIDTH.initial);
	const [keptWidth, setKeptWidth] = useState<number>(PANEL_WIDTH.initial);
	// The preference as last stored, so an unchanged one is not written again.
	const storedPreference = useRef<FluePreference | null>(null);
	const loaded = userKey !== undefined && loadedFor === userKey;

	/*
	 * The stored agent is kept only while the user may still use it. The
	 * stored thread is kept while it is not archived and is the agent's chat
	 * or, for a user who may read them, a run of any agent.
	 */
	useEffect(() => {
		if (userKey === undefined) {
			return;
		}

		let active = true;

		const restore = async (): Promise<void> => {
			const [stored, available] = await Promise.all([
				getPreference<FluePreference | null>(PREFERENCE_KEY).catch(() => null),
				api.agents().catch((error: unknown) => {
					toast.error(errorText(error, "The agents could not be listed."));

					return { agents: [], runs: null, attachments: null };
				}),
			]);
			const kept = available.agents.some(
				(entry) => entry.slug === stored?.agent,
			);
			const selected = kept
				? (stored?.agent ?? undefined)
				: available.agents[0]?.slug;
			const restored = stored?.threadId
				? await api
						.thread(stored.threadId)
						.then((thread) =>
							thread.status !== "archived" &&
							(isRun(thread)
								? available.runs !== null
								: thread.agent === selected)
								? String(thread.id)
								: undefined,
						)
						.catch(() => undefined)
				: undefined;
			const storedWidth = clampWidth(
				typeof stored?.width === "number" ? stored.width : PANEL_WIDTH.initial,
			);

			if (!active) {
				return;
			}

			storedPreference.current = stored;
			setAgents(available.agents);
			setRunAgents(available.runs?.agents);
			setAttachments(available.attachments);
			setAgent(selected);
			setThreadId(restored);

			// Without an agent to chat with, the panel lists runs.
			if (selected === undefined) {
				setView("threads");
			}

			setOpen(stored?.open === true);
			setWidth(storedWidth);
			setKeptWidth(storedWidth);
			setLoadedFor(userKey);
		};

		void restore();

		return () => {
			active = false;
		};
	}, [api, getPreference, userKey]);

	useEffect(() => {
		if (!loaded) {
			return;
		}

		const preference: FluePreference = {
			open,
			agent: agent ?? null,
			threadId: threadId ?? null,
			width: keptWidth,
		};
		const stored = storedPreference.current;

		if (
			stored?.open === preference.open &&
			stored.agent === preference.agent &&
			stored.threadId === preference.threadId &&
			stored.width === preference.width
		) {
			return;
		}

		storedPreference.current = preference;
		void setPreference<FluePreference>(PREFERENCE_KEY, preference);
	}, [loaded, open, agent, threadId, keptWidth, setPreference]);

	const toggle = useCallback(() => {
		setOpen((current) => !current);
	}, []);

	const close = useCallback(() => {
		setOpen(false);
	}, []);

	// Signed out, the key keeps its default.
	const onHotkey = useCallback(
		(event: KeyboardEvent) => {
			if (!loaded) {
				return;
			}

			event.preventDefault();
			toggle();
		},
		[loaded, toggle],
	);

	useHotkey({ cmdCtrlKey: true, editDepth: 1, keyCodes: HOTKEY }, onHotkey);

	const selectAgent = useCallback((slug: string) => {
		setAgent(slug);
		setThreadId(undefined);
		setChosen(false);
	}, []);

	// Sets agent and thread together, unlike selecting an agent.
	const openThread = useCallback((slug: string, id: string) => {
		setAgent(slug);
		setThreadId(id);
		setChosen(true);
		setView("conversation");
	}, []);

	const endResize = useCallback((next: number) => {
		setWidth(next);
		setKeptWidth(next);
	}, []);

	const layoutStyle: Record<`--${string}`, string> & React.CSSProperties = {
		"--flue-panel-width": `${String(width)}px`,
	};

	const state = useMemo<FlueState>(
		() => ({ open, toggle, agents, runs: runAgents !== undefined, running }),
		[open, toggle, agents, runAgents, running],
	);

	/*
	 * The panel docks as a column next to the admin, which narrows to make
	 * room; below the medium breakpoint it overlays the admin instead. Until
	 * the chat's code arrives, an empty panel holds its place.
	 */
	return (
		<FlueContext value={loaded ? state : null}>
			<style href="payloadcms-flue-panel" precedence="default">
				{PANEL_CSS}
			</style>
			<div className="flue-layout" style={layoutStyle}>
				<div className="flue-layout__main">
					<DocumentRegistryContext value={registry}>
						{children}
					</DocumentRegistryContext>
				</div>
				{loaded &&
				userId !== undefined &&
				(agent !== undefined || runAgents !== undefined) ? (
					<Suspense
						fallback={
							<aside
								aria-busy="true"
								aria-label="Agent chat"
								className="flue-panel"
								hidden={!open}
								id={PANEL_ID}
							/>
						}
					>
						<FlueChat
							agent={agent}
							agents={agents}
							api={api}
							attachments={attachments}
							chosen={chosen}
							key={`${userKey}:${agent ?? ""}`}
							onAgent={selectAgent}
							onClose={close}
							onOpenThread={openThread}
							onResize={setWidth}
							onResizeEnd={endResize}
							onRunning={setRunning}
							onThreadId={setThreadId}
							onView={setView}
							open={open}
							registry={registry}
							runAgents={runAgents}
							threadId={threadId}
							userCollection={userCollection}
							userId={userId}
							view={view}
							width={width}
						/>
					</Suspense>
				) : null}
			</div>
		</FlueContext>
	);
};
