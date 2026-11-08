import { KEYSET_SORT, keysetWhere, whereParams } from "./keyset.js";
import { isRecord } from "../protocol/guards.js";
import { routePath } from "../protocol/paths.js";

import type { Keyset, Where } from "./keyset.js";
import type { ChatContext, RunKind } from "../protocol/context.js";
import type { ThreadStatus } from "../protocol/events.js";
import type { RelationValue } from "../protocol/owner.js";

export type ThreadId = number | string;

/** An agent the signed-in user may chat with, as `GET /agents` lists it. */
export interface AgentSummary {
	slug: string;
	label?: string;
	description?: string;
}

/** What `GET /agents` answers. */
export interface AgentsAnswer {
	/** The agents the user may chat with. */
	agents: AgentSummary[];
	/** Every agent, when the user may read agent runs; null otherwise. */
	runs: null | { agents: AgentSummary[] };
}

/** A thread row as the REST API returns it at depth 0. */
export interface ThreadDoc {
	id: ThreadId;
	agent: string;
	title?: null | string;
	status: ThreadStatus;
	kind?: null | RunKind;
	context?: null | {
		collection?: null | string;
		docId?: null | string;
		global?: null | string;
	};
	createdBy?: null | RelationValue;
	lastMessageAt?: null | string;
	lastReadAt?: null | string;
}

/** Which threads a list shows; archived threads are always left out. */
export type ThreadFilter =
	| {
			kind: "chat";
			/** One agent, or any of several. */
			agent: string | readonly string[];
			/** Part of the title, for search. */
			title?: string;
	  }
	| { kind: "run"; agent?: string; title?: string };

/** One page of a thread list, newest message first. */
export interface ThreadPage {
	docs: ThreadDoc[];
	hasNextPage: boolean;
}

/** What the poll reads again of a running thread. */
export type ThreadState = Pick<ThreadDoc, "id" | "lastMessageAt" | "status">;

const filterWhere = (filter: ThreadFilter): Where[] => {
	const conditions: Where[] = [{ status: { not_equals: "archived" } }];

	if (filter.kind === "chat") {
		conditions.push({ kind: { equals: "chat" } });
	} else {
		conditions.push({ kind: { in: ["reactive", "ambient"] } });
	}

	if (typeof filter.agent === "string") {
		conditions.push({ agent: { equals: filter.agent } });
	} else if (filter.agent !== undefined) {
		conditions.push({ agent: { in: [...filter.agent] } });
	}

	if (filter.title !== undefined) {
		conditions.push({ title: { like: filter.title } });
	}

	return conditions;
};

/** Whether the thread is an agent run, reactive or ambient, rather than a chat. */
export const isRun = (thread: Pick<ThreadDoc, "kind">): boolean =>
	thread.kind === "reactive" || thread.kind === "ambient";

/** Whether the thread has messages its owner has not opened since. */
export const isUnread = (thread: ThreadDoc): boolean =>
	typeof thread.lastMessageAt === "string" &&
	(typeof thread.lastReadAt !== "string" ||
		Date.parse(thread.lastMessageAt) > Date.parse(thread.lastReadAt));

/** What the panel sends with a message. The server adds `updatedAt`. */
export type SendContext = Pick<
	ChatContext,
	"collection" | "global" | "id" | "locale" | "route"
>;

/** What `POST /chat/:agent` returns. */
export interface ChatResult {
	thread: Pick<ThreadDoc, "id" | "status" | "title">;
	/** Where the updates of the accepted message start. */
	offset: string;
	streamUrl: string;
	submissionId: string;
}

/** A decision on a call waiting for approval, as mcpx takes it. */
export type ConfirmationDecision = "approved" | "rejected";

export interface FlueApiOptions {
	serverURL: string;
	/** `config.routes.api`. */
	apiRoute: string;
	endpointPath: string;
	threadsSlug: string;
	/** mcpx's endpoint path, below which its confirmations endpoints sit. */
	mcpxEndpointPath: string;
}

/**
 * A message for a failed call that a user can read. The SDK's and the stream
 * client's errors name URLs and protocol details, so only the plugin's own
 * refusal they carry is shown, and the fallback otherwise.
 */
export const errorText = (error: unknown, fallback: string): string => {
	if (!(error instanceof Error)) {
		return fallback;
	}

	// `FlueApiError.body`, `FetchError.json` and `DurableStreamError.details`.
	const { body, json, details } = error as Error & Record<string, unknown>;

	for (const candidate of [body, json, details]) {
		if (isRecord(candidate) && typeof candidate["error"] === "string") {
			return candidate["error"];
		}
	}

	return error.name === "Error" ? error.message : fallback;
};

// The plugin's endpoints answer `{ error }`, Payload's REST API `{ errors }`.
const errorMessage = async (response: Response): Promise<string> => {
	const body = ((await response.json().catch(() => null)) ?? {}) as {
		error?: unknown;
		errors?: { message?: unknown }[];
	};
	const message =
		typeof body.error === "string" ? body.error : body.errors?.[0]?.message;

	return typeof message === "string"
		? message
		: `The request failed with status ${String(response.status)}.`;
};

const fetchOk = async (url: string, init?: RequestInit): Promise<Response> => {
	const response = await fetch(url, { credentials: "include", ...init });

	if (!response.ok) {
		throw new Error(await errorMessage(response));
	}

	return response;
};

const request = async <T>(url: string, init?: RequestInit): Promise<T> =>
	(await (await fetchOk(url, init)).json()) as T;

const json = (method: "PATCH" | "POST", body: unknown): RequestInit => ({
	method,
	headers: { "content-type": "application/json" },
	body: JSON.stringify(body),
});

/**
 * The plugin's endpoints, the threads collection's REST API and mcpx's
 * confirmations endpoints, as the signed-in admin user calls them. Each call
 * throws with the server's message when it is refused.
 */
export const flueApi = ({
	serverURL,
	apiRoute,
	endpointPath,
	threadsSlug,
	mcpxEndpointPath,
}: FlueApiOptions) => {
	const api = `${serverURL.replace(/\/+$/, "")}${apiRoute}`;
	const plugin = (path: string): string => `${api}${endpointPath}${path}`;
	const row = (id: ThreadId): string =>
		`${api}/${threadsSlug}/${encodeURIComponent(String(id))}`;
	const confirmations = `${api}${mcpxEndpointPath}/confirmations`;

	return {
		agents: async (): Promise<AgentsAnswer> => {
			const { agents, runs } = await request<AgentsAnswer>(
				plugin(routePath("agents")),
			);

			return { agents, runs: runs ?? null };
		},

		/**
		 * A page of the threads the user can read that match `filter`, newest
		 * message first, continuing after `after`.
		 */
		threads: async (
			filter: ThreadFilter,
			page: { limit: number; after?: Keyset | undefined },
		): Promise<ThreadPage> => {
			const params = whereParams(
				{ and: [...filterWhere(filter), ...keysetWhere(page.after)] },
				{ sort: KEYSET_SORT, limit: String(page.limit), depth: "0" },
			);
			const { docs, hasNextPage } = await request<ThreadPage>(
				`${api}/${threadsSlug}?${params.toString()}`,
			);

			return { docs, hasNextPage };
		},

		/** The status and message time of the threads with these ids. */
		threadStates: async (ids: readonly ThreadId[]): Promise<ThreadState[]> => {
			const params = whereParams(
				{ id: { in: ids.map(String) } },
				{
					"select[status]": "true",
					"select[lastMessageAt]": "true",
					limit: String(ids.length),
					depth: "0",
				},
			);

			return (
				await request<{ docs: ThreadState[] }>(
					`${api}/${threadsSlug}?${params.toString()}`,
				)
			).docs;
		},

		thread: (id: ThreadId): Promise<ThreadDoc> => request(`${row(id)}?depth=0`),

		chat: (
			agent: string,
			body: {
				message: string;
				thread?: ThreadId | undefined;
				context: SendContext;
			},
		): Promise<ChatResult> =>
			request(plugin(routePath("chat", { agent })), json("POST", body)),

		/** The Flue conversation of a thread, as the SDK client addresses it. */
		conversationUrl: (thread: ThreadId): string =>
			plugin(routePath("conversation", { thread })),

		/**
		 * Reads the newest entry of a thread's conversation, which brings the
		 * row's status and title up to date with Flue's history.
		 */
		reconcile: async (thread: ThreadId): Promise<void> => {
			const response = await fetchOk(
				`${plugin(routePath("conversation", { thread }))}?view=history&limit=1`,
			);

			await response.body?.cancel();
		},

		/*
		 * The SDK's abort sends no body, while the endpoint requires the JSON
		 * content type. Its answer is not needed.
		 */
		abort: async (thread: ThreadId): Promise<void> => {
			await fetchOk(
				plugin(routePath("conversationAbort", { thread })),
				json("POST", {}),
			);
		},

		rename: (thread: ThreadId, title: string): Promise<unknown> =>
			request(row(thread), json("PATCH", { title })),

		archive: (thread: ThreadId): Promise<unknown> =>
			request(row(thread), json("PATCH", { status: "archived" })),

		/** Marks the thread read up to `readAt`, its last message's time. */
		markRead: (thread: ThreadId, readAt: string): Promise<unknown> =>
			request(row(thread), json("PATCH", { lastReadAt: readAt })),

		/**
		 * The handle mcpx decides a pending call by, or undefined once the call
		 * is no longer pending. Only the key's user may read it.
		 */
		confirmationHandle: async (
			key: string,
			confirmation: string,
		): Promise<string | undefined> => {
			const params = new URLSearchParams({ key, confirmation });
			const { confirmations: pending } = await request<{
				confirmations: { handle: string; highlighted: boolean }[];
			}>(`${confirmations}?${params.toString()}`);

			return pending.find((entry) => entry.highlighted)?.handle;
		},

		/** Resolves to whether mcpx recorded the decision. */
		decide: async (
			key: string,
			handle: string,
			decision: ConfirmationDecision,
		): Promise<boolean> =>
			(
				await request<{ decided: string[] }>(
					confirmations,
					json("POST", { key, handles: [handle], decision }),
				)
			).decided.includes(handle),
	};
};

export type FlueApi = ReturnType<typeof flueApi>;
