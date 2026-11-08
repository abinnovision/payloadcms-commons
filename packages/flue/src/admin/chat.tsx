"use client";

import { AssistantRuntimeProvider } from "@assistant-ui/react";
import {
	toast,
	useConfig,
	useLocale,
	usePathname,
	useSearchParams,
} from "@payloadcms/ui";
import React, {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";

import { isUnread } from "./api.js";
import { FluePanel } from "./panel.js";
import { contextFromPath } from "./route-context.js";
import { useFlueRuntime } from "./runtime.js";
import { staleRunning } from "./stale-running.js";
import { ToolsContext } from "./tools.js";
import { isOwner } from "../protocol/owner.js";

import type { SendContext, ThreadDoc } from "./api.js";
import type { FluePanelProps } from "./panel.js";
import type { ChatSession } from "./runtime.js";
import type { RunningRow } from "./stale-running.js";
import type { ToolsContextValue } from "./tools.js";

export type FlueChatProps = Omit<
	FluePanelProps,
	"loadMoreError" | "onOpenRun" | "onStale"
> & {
	/** The signed-in user, a member of `userCollection`. */
	userId: number | string;
	userCollection: string;
	threadId: string | undefined;
	/** The user opened `threadId`, so the document's thread does not replace it. */
	chosen: boolean;
	onThreadId: (threadId: string | undefined) => void;
	onRunning: (running: boolean) => void;
};

const showError = (message: string): void => {
	toast.error(message);
};

// The document an edit view shows, or the global, as one comparable value.
const documentKey = (
	collection: null | string | undefined,
	id: null | string | undefined,
	global: null | string | undefined,
): string | undefined => {
	if (collection && id) {
		return `${collection}/${id}`;
	}

	return global ? `global/${global}` : undefined;
};

/*
 * When each thread was last read for a settlement the list may have missed.
 * Kept across mounts, so switching agents does not lift the five-minute cap.
 */
const staleReads = new Map<string, number>();

/**
 * The runtime of one agent's threads and the panel showing it. Mounted again
 * for another agent, on the thread opened with it or a new one. Loaded on its
 * own, so the admin's first load carries none of the chat's code.
 */
export const FlueChat: React.FC<FlueChatProps> = ({
	userId,
	userCollection,
	threadId,
	chosen: chosenOnMount,
	onThreadId,
	onRunning,
	onOpenThread,
	...panel
}) => {
	const { api, agent, open, attachments = null } = panel;
	const { config } = useConfig();
	const pathname = usePathname();
	const searchParams = useSearchParams();
	const locale = useLocale();
	// Undefined until the thread list has loaded; every loaded page after.
	const [threads, setThreads] = useState<ThreadDoc[]>();
	const [loadMoreError, setLoadMoreError] = useState<unknown>();
	// Set once the user opens a thread, or a new one, in the panel.
	const chosen = useRef(chosenOnMount);
	// Threads outside the loaded rows, read once each to mark them read.
	const outside = useRef(new Map<string, Promise<ThreadDoc>>());
	// The document whose thread was last opened by default.
	const defaultedFor = useRef<string | undefined>(undefined);
	// The thread and message time last marked read, so it is sent once.
	const markedRead = useRef<string | undefined>(undefined);
	const runtimeRef = useRef<ReturnType<typeof useFlueRuntime>>(null);

	const route = useMemo(
		() => contextFromPath(pathname, config.routes.admin),
		[pathname, config.routes.admin],
	);
	const localeCode = locale?.code ?? searchParams.get("locale") ?? undefined;
	const docKey = documentKey(route.collection, route.id, route.global);
	// On the id, as the auth user object is replaced whenever the session refreshes.
	const isOwn = useCallback(
		(thread: ThreadDoc) =>
			isOwner(
				thread.createdBy,
				{ id: userId, collection: userCollection },
				userCollection,
			),
		[userId, userCollection],
	);

	const session: ChatSession = {
		api,
		agent,
		context: (): SendContext =>
			localeCode === undefined ? route : { ...route, locale: localeCode },
		attachments,
		refresh: () => {
			runtimeRef.current?.threads.reload().catch(() => undefined);
		},
		onError: showError,
	};
	const sessionRef = useRef(session);

	sessionRef.current = session;

	const onThreadIdChange = useCallback(
		(id: string | undefined) => {
			chosen.current = true;
			onThreadId(id);
		},
		[onThreadId],
	);

	/*
	 * A row still running two minutes after its last message may have missed
	 * its settlement. Reading its history through the conversation endpoint
	 * reconciles the row; the next list load shows it.
	 */
	const onStale = useCallback(
		(rows: readonly RunningRow[]) => {
			const now = Date.now();

			for (const id of staleRunning(rows, now, staleReads)) {
				staleReads.set(id, now);
				api.reconcile(id).catch(() => undefined);
			}
		},
		[api],
	);

	const onList = useCallback(
		(rows: ThreadDoc[]) => {
			setThreads(rows);
			onStale(rows);
		},
		[onStale],
	);

	const onLoadMoreError = useCallback((error: unknown) => {
		setLoadMoreError(() => error);
	}, []);

	// A run, or a chat of this agent, opens in place.
	const openRun = useCallback(
		(id: string) => {
			chosen.current = true;
			onThreadId(id);
		},
		[onThreadId],
	);

	// Another agent's chat switches the agent.
	const openThread = useCallback(
		(slug: string, id: string) => {
			if (slug === agent) {
				openRun(id);
			} else {
				onOpenThread(slug, id);
			}
		},
		[agent, openRun, onOpenThread],
	);

	const runtime = useFlueRuntime({
		session: sessionRef,
		api,
		agent,
		isOwn,
		onList,
		onLoadMoreError,
		threadId,
		onThreadIdChange,
	});

	runtimeRef.current = runtime;

	const subscribeThread = useCallback(
		(listener: () => void) => runtime.thread.subscribe(listener),
		[runtime],
	);
	const running = useSyncExternalStore(
		subscribeThread,
		() => runtime.thread.getState().isRunning,
		() => false,
	);

	useEffect(() => {
		onRunning(running);
	}, [onRunning, running]);

	useEffect(
		() => () => {
			onRunning(false);
		},
		[onRunning],
	);

	/*
	 * On an edit view the newest thread about the document opens, once per
	 * document. It never replaces a thread the user opened in this session or
	 * one that runs, and a document without a thread keeps the open one, so
	 * following a link from the panel does not lose the conversation.
	 */
	useEffect(() => {
		if (docKey === undefined) {
			defaultedFor.current = undefined;

			return;
		}

		if (threads === undefined || defaultedFor.current === docKey) {
			return;
		}

		defaultedFor.current = docKey;

		if (chosen.current || running) {
			return;
		}

		const match = threads.find(
			(thread) =>
				documentKey(
					thread.context?.collection,
					thread.context?.docId,
					thread.context?.global,
				) === docKey,
		)?.id;

		if (match !== undefined && String(match) !== threadId) {
			onThreadId(String(match));
		}
	}, [docKey, threads, threadId, running, onThreadId]);

	/*
	 * Reads up to the last message's server time, so a skewed client clock
	 * cannot leave the thread unread. Only the owner's reads are tracked, and
	 * only while the panel shows the thread. A thread opened from search or
	 * deeper than the loaded pages is read on its own.
	 */
	useEffect(() => {
		if (!open || threadId === undefined || threads === undefined) {
			return;
		}

		let active = true;
		const listed = threads.find((thread) => String(thread.id) === threadId);
		const read =
			listed === undefined
				? (outside.current.get(threadId) ?? api.thread(threadId))
				: Promise.resolve(listed);

		if (listed === undefined) {
			outside.current.set(threadId, read);
		}

		void read
			.then(async (thread) => {
				const lastMessageAt = thread.lastMessageAt;

				if (
					!active ||
					typeof lastMessageAt !== "string" ||
					!isOwn(thread) ||
					!isUnread(thread)
				) {
					return;
				}

				const mark = `${String(thread.id)}@${lastMessageAt}`;

				if (markedRead.current === mark) {
					return;
				}

				markedRead.current = mark;
				await api.markRead(thread.id, lastMessageAt);
				await runtime.threads.reload();
			})
			.catch(() => {
				// A failed read is tried again on the next list load.
				outside.current.delete(threadId);
			});

		return () => {
			active = false;
		};
	}, [open, threadId, threads, api, isOwn, runtime]);

	const tools = useMemo<ToolsContextValue>(
		() => ({
			api,
			adminRoute: config.routes.admin,
			// A server render has no window, so the server URL stands in for it.
			origin:
				typeof window === "undefined"
					? config.serverURL
					: window.location.origin,
		}),
		[api, config.routes.admin, config.serverURL],
	);

	return (
		<AssistantRuntimeProvider runtime={runtime}>
			<ToolsContext value={tools}>
				<FluePanel
					{...panel}
					loadMoreError={loadMoreError}
					onOpenRun={openRun}
					onOpenThread={openThread}
					onStale={onStale}
				/>
			</ToolsContext>
		</AssistantRuntimeProvider>
	);
};
