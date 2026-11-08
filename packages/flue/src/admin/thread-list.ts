import { isUnread } from "./api.js";
import { decodeCursor, encodeCursor, keysetOf } from "./keyset.js";

import type { FlueApi, ThreadDoc, ThreadId } from "./api.js";
import type { RunKind } from "../protocol/context.js";
import type { RemoteThreadListAdapter } from "@assistant-ui/react";

type ThreadMetadata = Awaited<ReturnType<RemoteThreadListAdapter["fetch"]>>;
type TitleStream = Awaited<
	ReturnType<RemoteThreadListAdapter["generateTitle"]>
>;

/** Rows per page of the thread list. */
export const PAGE_SIZE = 50;

/** The most rows a reload asks for, however deep the list was paged. */
export const RELOAD_MAX = 500;

/** What a listed thread carries for the panel beyond its title. */
export interface ThreadCustom extends Record<string, unknown> {
	/** The user may read the thread but did not start it, as for agent runs. */
	readOnly: boolean;
	unread: boolean;
	/** The row's status, which the list shows for threads that are not open. */
	running: boolean;
	failed: boolean;
	agent: string;
	kind: RunKind;
}

export interface ThreadListOptions {
	api: FlueApi;
	/** The agent whose chats are listed; none lists no chats. */
	agent: string | undefined;
	isOwn: (thread: ThreadDoc) => boolean;
	/** Receives every row loaded since the last reload, merged by id. */
	onList: (threads: ThreadDoc[]) => void;
	/** Receives the error of a failed next page, and undefined once a page loads. */
	onLoadMoreError: (error: unknown) => void;
	/**
	 * Resolves to the id of the thread the first message of a new thread
	 * created, keyed by the thread list's local id.
	 */
	created: (localId: string) => Promise<ThreadId>;
}

const metadataOf = (
	thread: ThreadDoc,
	isOwn: ThreadListOptions["isOwn"],
): ThreadMetadata => {
	const own = isOwn(thread);
	const custom: ThreadCustom = {
		readOnly: !own,
		unread: own && isUnread(thread),
		running: thread.status === "running",
		failed: thread.status === "failed",
		agent: thread.agent,
		kind: thread.kind ?? "chat",
	};

	return {
		status: thread.status === "archived" ? "archived" : "regular",
		remoteId: String(thread.id),
		title: thread.title ?? undefined,
		lastMessageAt:
			typeof thread.lastMessageAt === "string"
				? new Date(thread.lastMessageAt)
				: undefined,
		custom,
	};
};

/**
 * The user's chats with the agent for assistant-ui's thread list, over the
 * threads collection, paged by message time. Threads are archived, never
 * deleted, and a new one exists once its first message was sent. Titles come
 * from the agent, so none is generated.
 *
 * assistant-ui replaces the list with the first page on every reload, so a
 * list without a cursor asks for as many rows as were loaded since the last
 * one: a reload after a send or a settled run keeps every loaded page.
 */
export const threadListAdapter = ({
	api,
	agent,
	isOwn,
	onList,
	onLoadMoreError,
	created,
}: ThreadListOptions): RemoteThreadListAdapter => {
	let loaded = new Map<string, ThreadDoc>();
	// Counts lists without a cursor; a next page from before the last one is stale.
	let reloads = 0;

	// An archived thread leaves the rows, so nothing opens it by default again.
	const archive = async (remoteId: string): Promise<void> => {
		await api.archive(remoteId);

		if (loaded.delete(remoteId)) {
			onList([...loaded.values()]);
		}
	};

	return {
		list: async (params) => {
			const cursor = params?.after;

			if (agent === undefined) {
				onList([]);

				return { threads: [] };
			}

			const limit =
				cursor === undefined
					? Math.min(RELOAD_MAX, Math.max(PAGE_SIZE, loaded.size))
					: PAGE_SIZE;

			if (cursor === undefined) {
				reloads += 1;
			}

			const reload = reloads;

			try {
				const page = await api.threads(
					{ kind: "chat", agent },
					{
						limit,
						after: cursor === undefined ? undefined : decodeCursor(cursor),
					},
				);

				if (cursor === undefined) {
					loaded = new Map();
				}

				for (const thread of page.docs) {
					loaded.set(String(thread.id), thread);
				}

				if (reload === reloads) {
					onLoadMoreError(undefined);
				}

				onList([...loaded.values()]);

				const last = page.docs.at(-1);
				const next =
					page.hasNextPage && last !== undefined ? keysetOf(last) : undefined;

				return {
					threads: page.docs.map((thread) => metadataOf(thread, isOwn)),
					nextCursor: next === undefined ? undefined : encodeCursor(next),
				};
			} catch (error) {
				// assistant-ui only logs a failed next page, so the panel shows it.
				if (cursor !== undefined && reload === reloads) {
					onLoadMoreError(error);
				}

				throw error;
			}
		},
		fetch: async (remoteId) => metadataOf(await api.thread(remoteId), isOwn),
		rename: async (remoteId, title) => {
			await api.rename(remoteId, title);
		},
		archive,
		delete: archive,
		initialize: async (localId) => ({
			remoteId: String(await created(localId)),
			externalId: undefined,
		}),
		generateTitle: (): Promise<TitleStream> =>
			Promise.resolve(
				new ReadableStream({
					start: (controller) => {
						controller.close();
					},
				}),
			),
	};
};
