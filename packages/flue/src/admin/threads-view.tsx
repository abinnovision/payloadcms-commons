"use client";

import {
	ThreadListItemPrimitive,
	ThreadListPrimitive,
	useAui,
	useAuiState,
} from "@assistant-ui/react";
import { ChevronIcon, SearchIcon, SpinnerIcon, XIcon } from "@payloadcms/ui";
import React, {
	createContext,
	Fragment,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";

import { isRun } from "./api.js";
import { dateBucket } from "./date-buckets.js";
import { PAGE_SIZE } from "./thread-list.js";
import { useThreadPages } from "./thread-pages.js";
import { agentLabel, RowBody, runMeta } from "./thread-row.js";

import type { AgentSummary, FlueApi, ThreadDoc, ThreadState } from "./api.js";
import type { RunningRow } from "./stale-running.js";
import type { ThreadCustom } from "./thread-list.js";
import type { PageLoader } from "./thread-pages.js";

/** Rows per page of search results. */
const SEARCH_PAGE_SIZE = 20;

/** Characters a search needs. */
const SEARCH_MIN = 2;

const SEARCH_DEBOUNCE_MS = 250;

/** How often the rows shown as running are read again. */
export const POLL_MS = 20_000;

const SKELETON_ROWS = 6;

const TRIGGER = ".flue-row__trigger";

/** What the rows of the runtime's list read from the view. */
interface RowContextValue {
	now: Date;
	/** Called once a row opened its thread. */
	onOpened: () => void;
}

const RowContext = createContext<RowContextValue>({
	now: new Date(0),
	onOpened: () => undefined,
});

const timeOf = (
	value: Date | null | string | undefined,
): number | undefined => {
	if (value instanceof Date) {
		return value.getTime();
	}

	return typeof value === "string" ? Date.parse(value) : undefined;
};

// Newest message first; a thread without one yet, just started, comes first.
const newestFirst = (
	a: { lastMessageAt?: Date | undefined },
	b: { lastMessageAt?: Date | undefined },
): number =>
	(b.lastMessageAt?.getTime() ?? Number.POSITIVE_INFINITY) -
		(a.lastMessageAt?.getTime() ?? Number.POSITIVE_INFINITY) || 0;

/*
 * Moves focus off a row that is about to go, to the row after it or else the
 * one before.
 */
const focusNeighbour = (row: Element | null): void => {
	const list = row?.closest(".flue-threads__list");
	const trigger = row?.querySelector<HTMLElement>(TRIGGER);

	if (!list || !trigger) {
		return;
	}

	const triggers = [...list.querySelectorAll<HTMLElement>(TRIGGER)];
	const index = triggers.indexOf(trigger);

	(triggers[index + 1] ?? triggers[index - 1])?.focus();
};

/** A chat in the runtime's list, which opens it in place. */
const ChatRow: React.FC = () => {
	const { now, onOpened } = useContext(RowContext);
	const item = useAuiState((state) => state.threadListItem);
	const custom = item.custom as Partial<ThreadCustom> | undefined;
	const unread = custom?.unread === true;

	return (
		<ThreadListItemPrimitive.Root
			className="flue-row"
			data-unread={unread ? "" : undefined}
		>
			<ThreadListItemPrimitive.Trigger
				className="flue-row__trigger"
				onClick={onOpened}
			>
				<RowBody
					failed={custom?.failed === true}
					lastMessageAt={item.lastMessageAt}
					now={now}
					running={custom?.running === true || item.isRunning}
					title={<ThreadListItemPrimitive.Title fallback="Untitled" />}
					unread={unread}
				/>
			</ThreadListItemPrimitive.Trigger>
			{custom?.readOnly === true ? null : (
				<ThreadListItemPrimitive.Archive
					aria-label="Archive thread. Archived threads cannot be reopened."
					className="flue-row__archive"
					onClick={(event) => {
						focusNeighbour(event.currentTarget.parentElement);
					}}
					tabIndex={-1}
				>
					Archive
				</ThreadListItemPrimitive.Archive>
			)}
		</ThreadListItemPrimitive.Root>
	);
};

const CHAT_ROW = { ThreadListItem: ChatRow };

/** A row of a pane the panel pages itself, read-only. */
const PageRow: React.FC<{
	row: ThreadDoc;
	now: Date;
	active: boolean;
	meta?: string | undefined;
	onOpen: (row: ThreadDoc) => void;
}> = ({ row, now, active, meta, onOpen }) => (
	<div className="flue-row" data-active={active ? "" : undefined}>
		<button
			aria-current={active ? "true" : undefined}
			className="flue-row__trigger"
			onClick={() => {
				onOpen(row);
			}}
			type="button"
		>
			<RowBody
				failed={row.status === "failed"}
				lastMessageAt={
					typeof row.lastMessageAt === "string"
						? new Date(row.lastMessageAt)
						: undefined
				}
				meta={meta}
				now={now}
				running={row.status === "running"}
				title={row.title ?? "Untitled"}
				unread={false}
			/>
		</button>
	</div>
);

/** A row of a list as the date groups read it. */
export interface ListEntry {
	key: string;
	lastMessageAt?: Date | undefined;
}

export interface ThreadsListProps {
	entries: readonly ListEntry[];
	/** Puts the rows under date headings. */
	grouped: boolean;
	now: Date;
	loading: boolean;
	loadingMore: boolean;
	hasMore: boolean;
	error: unknown;
	loadMoreError: unknown;
	/** Shown when the list loaded no rows. */
	empty: React.ReactNode;
	renderRow: (index: number) => React.ReactNode;
	onLoadMore: () => void;
	/** Loads the first page again after it failed. */
	onRetry: () => void;
	/** Loads the next page again after it failed. */
	onRetryMore: () => void;
}

/**
 * The scrolling list of a pane with its states: skeleton rows while the
 * first page loads, the empty and error states, and below the rows the next
 * page, loaded when the end scrolls into view or on request.
 */
export const ThreadsList: React.FC<ThreadsListProps> = ({
	entries,
	grouped,
	now,
	loading,
	loadingMore,
	hasMore,
	error,
	loadMoreError,
	empty,
	renderRow,
	onLoadMore,
	onRetry,
	onRetryMore,
}) => {
	const scroller = useRef<HTMLDivElement>(null);
	const sentinel = useRef<HTMLDivElement>(null);
	const canLoadMore =
		hasMore && !loadingMore && loadMoreError === undefined && !loading;
	const more = useRef(onLoadMore);

	more.current = onLoadMore;

	useEffect(() => {
		const target = sentinel.current;

		if (
			!canLoadMore ||
			target === null ||
			typeof IntersectionObserver === "undefined"
		) {
			return;
		}

		const observer = new IntersectionObserver(
			(observed) => {
				if (observed.some((entry) => entry.isIntersecting)) {
					more.current();
				}
			},
			{ root: scroller.current, rootMargin: "0px 0px 240px 0px" },
		);

		observer.observe(target);

		return () => {
			observer.disconnect();
		};
	}, [canLoadMore, entries.length]);

	// One row is in the tab order: the one focused last, or the first.
	useEffect(() => {
		const triggers = scroller.current?.querySelectorAll<HTMLElement>(TRIGGER);
		const focused =
			scroller.current?.querySelector<HTMLElement>(`${TRIGGER}[data-roving]`) ??
			null;

		triggers?.forEach((trigger, index) => {
			trigger.tabIndex =
				trigger === focused || (focused === null && index === 0) ? 0 : -1;
		});
	});

	let body: React.ReactNode;

	if (error !== undefined && entries.length === 0) {
		body = (
			<div className="flue-threads__state" role="alert">
				<p>The threads could not be loaded.</p>
				<button className="flue-button" onClick={onRetry} type="button">
					Retry
				</button>
			</div>
		);
	} else if (loading && entries.length === 0) {
		body = (
			<div className="flue-threads__skeleton" role="status">
				<span className="flue-visually-hidden">Loading threads.</span>
				{Array.from({ length: SKELETON_ROWS }, (_, index) => (
					<span aria-hidden="true" className="flue-skeleton" key={index} />
				))}
			</div>
		);
	} else if (entries.length === 0) {
		body = <div className="flue-threads__state">{empty}</div>;
	} else {
		let previous: string | undefined;

		body = (
			<>
				{entries.map((entry, index) => {
					const bucket = grouped
						? dateBucket(entry.lastMessageAt ?? now, now)
						: undefined;
					const heading =
						bucket !== undefined && bucket.key !== previous ? (
							<h3 className="flue-threads__group">{bucket.label}</h3>
						) : null;

					previous = bucket?.key;

					return (
						<Fragment key={entry.key}>
							{heading}
							{renderRow(index)}
						</Fragment>
					);
				})}
				{loadingMore ? (
					<p className="flue-threads__more" role="status">
						<SpinnerIcon size="sm" />
						<span className="flue-visually-hidden">Loading more threads.</span>
					</p>
				) : loadMoreError === undefined ? (
					hasMore ? (
						<div className="flue-threads__more" ref={sentinel}>
							<button
								className="flue-button"
								onClick={onLoadMore}
								type="button"
							>
								Load more
							</button>
						</div>
					) : null
				) : (
					<div className="flue-threads__more" role="alert">
						<p>More threads could not be loaded.</p>
						<button className="flue-button" onClick={onRetryMore} type="button">
							Retry
						</button>
					</div>
				)}
			</>
		);
	}

	return (
		<div
			className="flue-threads__list"
			onFocus={(event) => {
				const trigger = event.target.closest<HTMLElement>(TRIGGER);

				if (trigger === null) {
					return;
				}

				for (const marked of event.currentTarget.querySelectorAll(
					"[data-roving]",
				)) {
					marked.removeAttribute("data-roving");
				}

				trigger.setAttribute("data-roving", "");

				for (const other of event.currentTarget.querySelectorAll<HTMLElement>(
					TRIGGER,
				)) {
					other.tabIndex = other === trigger ? 0 : -1;
				}
			}}
			ref={scroller}
		>
			{body}
		</div>
	);
};

/*
 * Reads the rows shown as running again every {@link POLL_MS} while the
 * pane is shown and the document visible.
 */
const useRunningPoll = (
	api: FlueApi,
	ids: readonly string[],
	onStates: (states: ThreadState[]) => void,
): void => {
	const latest = useRef(onStates);
	const key = ids.join(",");

	latest.current = onStates;

	useEffect(() => {
		if (key === "") {
			return;
		}

		const polled = key.split(",");
		// Cleared once the poll stops, so a late answer changes nothing.
		let live = true;
		const timer = setInterval(() => {
			if (document.visibilityState !== "visible") {
				return;
			}

			api.threadStates(polled).then(
				(states) => {
					if (live) {
						latest.current(states);
					}
				},
				() => undefined,
			);
		}, POLL_MS);

		return () => {
			live = false;
			clearInterval(timer);
		};
	}, [api, key]);
};

// Calls `onShow` each time `shown` turns true, not on mount.
const useOnShow = (shown: boolean, onShow: () => void): void => {
	const was = useRef(shown);
	const latest = useRef(onShow);

	latest.current = onShow;

	useEffect(() => {
		if (shown && !was.current) {
			latest.current();
		}

		was.current = shown;
	}, [shown]);
};

interface PaneProps {
	api: FlueApi;
	/** The pane is on screen, which the poll waits for. */
	active: boolean;
	now: Date;
	onStale: (rows: readonly RunningRow[]) => void;
}

/** The selected agent's chats, from the runtime's paged list. */
const ChatsPane: React.FC<
	PaneProps & {
		agentLabel: string;
		loadMoreError: unknown;
		onOpened: () => void;
	}
> = ({ api, active, now, onStale, agentLabel, loadMoreError, onOpened }) => {
	const aui = useAui();
	const ids = useAuiState((state) => state.threads.threadIds);
	const items = useAuiState((state) => state.threads.threadItems);
	const loading = useAuiState((state) => state.threads.isLoading);
	const loadingMore = useAuiState((state) => state.threads.isLoadingMore);
	const hasMore = useAuiState((state) => state.threads.hasMore);
	const loadError = useAuiState((state) => state.threads.loadError);
	/*
	 * The runtime also lists a thread it opened by id, such as a run or a
	 * search hit deeper than the loaded pages. Only chats are shown, in
	 * message order; each keeps its index in the runtime's list.
	 */
	const chats = useMemo(() => {
		const byId = new Map(items.map((item) => [item.id, item]));

		return ids
			.map((id, index) => ({ id, index, item: byId.get(id) }))
			.filter(
				({ item }) =>
					((item?.custom as Partial<ThreadCustom> | undefined)?.kind ??
						"chat") === "chat",
			);
	}, [ids, items]);
	const entries = useMemo(
		() =>
			chats
				.map(({ id, index, item }) => ({
					key: id,
					index,
					lastMessageAt: item?.lastMessageAt,
				}))
				.sort(newestFirst),
		[chats],
	);
	const running = useMemo(
		() =>
			chats.flatMap(({ item }) =>
				item?.remoteId !== undefined &&
				(item.custom as Partial<ThreadCustom> | undefined)?.running === true
					? [item]
					: [],
			),
		[chats],
	);

	// Showing the view again reloads the list, keeping every loaded page.
	useOnShow(active, () => {
		aui.threads.reload().catch(() => undefined);
	});

	// A changed row reloads the list, which keeps every loaded page.
	useRunningPoll(
		api,
		active ? running.map((item) => String(item.remoteId)) : [],
		(states) => {
			onStale(states);

			const read = new Map(states.map((entry) => [String(entry.id), entry]));
			const changed = running.some((item) => {
				const state = read.get(String(item.remoteId));

				return (
					state === undefined ||
					state.status !== "running" ||
					timeOf(state.lastMessageAt) !== timeOf(item.lastMessageAt)
				);
			});

			if (changed) {
				aui.threads.reload().catch(() => undefined);
			}
		},
	);

	const row = useMemo(() => ({ now, onOpened }), [now, onOpened]);

	return (
		<RowContext value={row}>
			<ThreadListPrimitive.Root className="flue-threads__pane">
				<ThreadsList
					empty={
						<>
							<p>{`No conversations with ${agentLabel} yet.`}</p>
							<ThreadListPrimitive.New
								className="flue-button"
								onClick={onOpened}
							>
								New thread
							</ThreadListPrimitive.New>
						</>
					}
					entries={entries}
					error={loadError ?? undefined}
					grouped
					hasMore={hasMore}
					loadMoreError={loadMoreError}
					loading={loading}
					loadingMore={loadingMore}
					now={now}
					onLoadMore={() => {
						void aui.threads.loadMore();
					}}
					onRetry={() => {
						aui.threads.reload().catch(() => undefined);
					}}
					onRetryMore={() => {
						void aui.threads.loadMore();
					}}
					renderRow={(position) => (
						<ThreadListPrimitive.ItemByIndex
							components={CHAT_ROW}
							index={entries[position]?.index ?? position}
						/>
					)}
				/>
			</ThreadListPrimitive.Root>
		</RowContext>
	);
};

/** A pane the panel pages itself over the REST API, such as search results. */
const PagesPane: React.FC<
	PaneProps & {
		load: PageLoader | undefined;
		grouped: boolean;
		empty: React.ReactNode;
		activeId: string | undefined;
		metaOf: (row: ThreadDoc) => string | undefined;
		onOpen: (row: ThreadDoc) => void;
	}
> = ({
	api,
	active,
	now,
	onStale,
	load,
	grouped,
	empty,
	activeId,
	metaOf,
	onOpen,
}) => {
	const pages = useThreadPages(load, onStale);
	const { rows, patch } = pages;

	// Showing the view again reads the first page afresh.
	useOnShow(active, pages.refresh);
	const entries = useMemo(
		() =>
			rows.map((row) => ({
				key: String(row.id),
				lastMessageAt:
					typeof row.lastMessageAt === "string"
						? new Date(row.lastMessageAt)
						: undefined,
			})),
		[rows],
	);

	useRunningPoll(
		api,
		active
			? rows
					.filter((row) => row.status === "running")
					.map((row) => String(row.id))
			: [],
		(states) => {
			patch(states);
			onStale(states);
		},
	);

	return (
		<div className="flue-threads__pane">
			<ThreadsList
				empty={empty}
				entries={entries}
				error={pages.error}
				grouped={grouped}
				hasMore={pages.hasMore}
				loadMoreError={pages.loadMoreError}
				loading={pages.loading}
				loadingMore={pages.loadingMore}
				now={now}
				onLoadMore={pages.loadMore}
				onRetry={pages.retry}
				onRetryMore={pages.retry}
				renderRow={(index) => {
					const row = rows[index];

					return row === undefined ? null : (
						<PageRow
							active={String(row.id) === activeId}
							meta={metaOf(row)}
							now={now}
							onOpen={onOpen}
							row={row}
						/>
					);
				}}
			/>
		</div>
	);
};

// The value a short pause in typing settles on; an empty one settles at once.
const useDebounced = (value: string, ms: number): string => {
	const [settled, setSettled] = useState(value);

	useEffect(() => {
		const timer = setTimeout(
			() => {
				setSettled(value);
			},
			value === "" ? 0 : ms,
		);

		return () => {
			clearTimeout(timer);
		};
	}, [value, ms]);

	return value === "" ? "" : settled;
};

export interface ThreadsViewProps {
	hidden: boolean;
	api: FlueApi;
	/** The selected agent; none in Runs-only mode. */
	agent: string | undefined;
	/** The agents the user may chat with. */
	agents: AgentSummary[];
	/** Every agent, when the user may read agent runs. */
	runAgents?: AgentSummary[] | undefined;
	/** The error of the runtime list's last failed next page. */
	loadMoreError: unknown;
	/** Reads the rows a settlement may have missed again. */
	onStale: (rows: readonly RunningRow[]) => void;
	/** Opens a chat of any agent from search. */
	onOpen: (agent: string, threadId: string) => void;
	/** Opens a run of any agent, read-only. */
	onOpenRun: (threadId: string) => void;
	/** Called once a thread opened, or a new one. */
	onOpened: () => void;
	/** Returns to the conversation. */
	onBack: () => void;
}

type Tab = "chats" | "runs";

const TABS: { id: Tab; label: string }[] = [
	{ id: "chats", label: "Chats" },
	{ id: "runs", label: "Runs" },
];

const tabId = (tab: Tab): string => `flue-threads-tab-${tab}`;

const PANE_ID = "flue-threads-pane";

/**
 * The full-height list of threads: a search field over the selected
 * agent's chats, grouped by date and paged as the list scrolls, and for a
 * user who may read them the agent runs of every agent on a second tab. A
 * search of two or more characters lists matching chats of every agent the
 * user may chat with, or matching runs.
 */
export const ThreadsView: React.FC<ThreadsViewProps> = ({
	hidden,
	api,
	agent,
	agents,
	runAgents,
	loadMoreError,
	onStale,
	onOpen,
	onOpenRun,
	onOpened,
	onBack,
}) => {
	const [tab, setTab] = useState<Tab>(agent === undefined ? "runs" : "chats");
	const [runAgent, setRunAgent] = useState<string>();
	const [query, setQuery] = useState("");
	const typed = query.trim();
	// Below the minimum the search ends at once, without waiting for the pause.
	const term = useDebounced(
		typed.length >= SEARCH_MIN ? typed : "",
		SEARCH_DEBOUNCE_MS,
	);
	const searching = term.length >= SEARCH_MIN;
	const search = useRef<HTMLInputElement>(null);
	const view = useRef<HTMLElement>(null);
	const [now, setNow] = useState(() => new Date());
	const activeId = useAuiState((state) => state.threadListItem.remoteId);
	const chatAgents = useMemo(() => agents.map((entry) => entry.slug), [agents]);
	const runs = tab === "runs" && runAgents !== undefined;
	const tabbed = agent !== undefined && runAgents !== undefined;

	// Opening the view focuses the search, with times read afresh.
	useOnShow(!hidden, () => {
		setNow(new Date());
		search.current?.focus();
	});

	const load = useMemo<PageLoader | undefined>(() => {
		if (runs) {
			return (after) =>
				api.threads(
					{
						kind: "run",
						...(runAgent === undefined ? {} : { agent: runAgent }),
						...(searching ? { title: term } : {}),
					},
					{ limit: searching ? SEARCH_PAGE_SIZE : PAGE_SIZE, after },
				);
		}

		return searching
			? (after) =>
					api.threads(
						{ kind: "chat", agent: chatAgents, title: term },
						{ limit: SEARCH_PAGE_SIZE, after },
					)
			: undefined;
	}, [api, chatAgents, runs, runAgent, searching, term]);

	const openRow = useCallback(
		(row: ThreadDoc) => {
			if (isRun(row)) {
				onOpenRun(String(row.id));
			} else {
				onOpen(row.agent, String(row.id));
			}

			onOpened();
		},
		[onOpen, onOpenRun, onOpened],
	);

	const clear = (): void => {
		setQuery("");
		search.current?.focus();
	};

	const selectTab = (next: Tab): void => {
		setTab(next);
		view.current?.querySelector<HTMLElement>(`#${tabId(next)}`)?.focus();
	};

	const onKeyDown = (event: React.KeyboardEvent<HTMLElement>): void => {
		if (event.altKey || event.ctrlKey || event.metaKey) {
			return;
		}

		if (event.key === "Escape") {
			event.preventDefault();
			event.stopPropagation();

			if (query === "") {
				onBack();
			} else {
				clear();
			}

			return;
		}

		const target = event.target as HTMLElement;

		// Of two tabs, either arrow moves to the other one.
		if (
			target.getAttribute("role") === "tab" &&
			(event.key === "ArrowLeft" || event.key === "ArrowRight")
		) {
			event.preventDefault();
			selectTab(target.id === tabId("chats") ? "runs" : "chats");

			return;
		}

		const triggers = [
			...(view.current?.querySelectorAll<HTMLElement>(TRIGGER) ?? []),
		];

		if (target === search.current) {
			if (event.key === "ArrowDown") {
				event.preventDefault();
				(
					triggers.find((trigger) => trigger.tabIndex === 0) ?? triggers[0]
				)?.focus();
			}

			return;
		}

		const row = target.closest(".flue-row");
		const trigger = row?.querySelector<HTMLElement>(TRIGGER);

		if (!row || !trigger || event.defaultPrevented) {
			return;
		}

		const index = triggers.indexOf(trigger);
		const next = {
			ArrowDown: triggers[index + 1],
			ArrowUp: index === 0 ? search.current : triggers[index - 1],
			Home: triggers[0],
			End: triggers.at(-1),
			ArrowRight:
				target === trigger
					? row.querySelector<HTMLElement>(".flue-row__archive")
					: undefined,
			ArrowLeft: target === trigger ? undefined : trigger,
		}[event.key];

		if (next) {
			event.preventDefault();
			next.focus();
		}
	};

	const labels = runAgents ?? agents;
	const emptySearch = (
		<>
			<p>{`No threads match “${term}”.`}</p>
			<button className="flue-button" onClick={clear} type="button">
				Clear search
			</button>
		</>
	);

	return (
		<section
			aria-label="Threads"
			className="flue-threads"
			hidden={hidden}
			onKeyDown={onKeyDown}
			ref={view}
		>
			{runAgents === undefined ? null : (
				<div className="flue-threads__bar">
					{tabbed ? (
						<div aria-label="Thread lists" className="flue-tabs" role="tablist">
							{TABS.map((entry) => (
								<button
									aria-controls={PANE_ID}
									aria-selected={tab === entry.id}
									className="flue-tabs__tab"
									id={tabId(entry.id)}
									key={entry.id}
									onClick={() => {
										setTab(entry.id);
									}}
									role="tab"
									tabIndex={tab === entry.id ? 0 : -1}
									type="button"
								>
									{entry.label}
								</button>
							))}
						</div>
					) : null}
					{runs ? (
						<span className="flue-threads__filter">
							<select
								aria-label="Agent of the runs"
								className="flue-panel__agent-select"
								onChange={(event) => {
									setRunAgent(event.target.value || undefined);
								}}
								value={runAgent ?? ""}
							>
								<option value="">All agents</option>
								{runAgents.map((entry) => (
									<option key={entry.slug} value={entry.slug}>
										{entry.label ?? entry.slug}
									</option>
								))}
							</select>
							<span aria-hidden="true" className="flue-panel__agent-chevron">
								<ChevronIcon size={16} />
							</span>
						</span>
					) : null}
				</div>
			)}
			<div className="flue-search">
				<span aria-hidden="true" className="flue-search__icon">
					<SearchIcon />
				</span>
				<input
					aria-label={runs ? "Search runs" : "Search threads"}
					className="flue-search__input"
					onChange={(event) => {
						setQuery(event.target.value);
					}}
					placeholder={runs ? "Search runs" : "Search threads"}
					ref={search}
					type="search"
					value={query}
				/>
				{query === "" ? null : (
					<button
						aria-label="Clear search"
						className="flue-icon-button flue-search__clear"
						onClick={clear}
						type="button"
					>
						<XIcon />
					</button>
				)}
			</div>
			<div
				aria-labelledby={tabbed ? tabId(tab) : undefined}
				className="flue-threads__pane"
				id={PANE_ID}
				role={tabbed ? "tabpanel" : undefined}
			>
				{runs || searching ? (
					<PagesPane
						active={!hidden}
						activeId={activeId}
						api={api}
						empty={
							searching ? (
								emptySearch
							) : (
								<p>
									No agent runs yet. Runs started by hooks and schedules appear
									here.
								</p>
							)
						}
						grouped={!searching}
						load={load}
						metaOf={(row) =>
							isRun(row)
								? runMeta(agentLabel(labels, row.agent), row.kind ?? undefined)
								: row.agent === agent
									? undefined
									: agentLabel(labels, row.agent)
						}
						now={now}
						onOpen={openRow}
						onStale={onStale}
					/>
				) : (
					<ChatsPane
						active={!hidden}
						agentLabel={agentLabel(agents, agent ?? "")}
						api={api}
						loadMoreError={loadMoreError}
						now={now}
						onOpened={onOpened}
						onStale={onStale}
					/>
				)}
			</div>
		</section>
	);
};
