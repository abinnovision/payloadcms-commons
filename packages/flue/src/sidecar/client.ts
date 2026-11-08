import { isRecord } from "../protocol/guards.js";

import type { FlueHistory } from "../protocol/events.js";

/** One message for a conversation. Flue takes exactly one per request. */
export interface SidecarMessage {
	kind: "signal";
	type: string;
	body: string;
	attributes: Record<string, string>;
}

export interface SendArgs {
	message: SidecarMessage;
	/**
	 * `null` admits the message only if it creates the conversation; a string
	 * only if the conversation is still the incarnation the string names.
	 * Left out, the message is admitted either way.
	 */
	uid?: null | string | undefined;
	/** Read when the request creates the conversation; needs `uid: null` or none. */
	initialData?: Record<string, unknown> | undefined;
}

/** What Flue answers when it admits a message. */
export interface Submission {
	/** Where a `view=updates` read replays the admitted message from. */
	offset: string;
	submissionId: string;
	/** The incarnation of the conversation that admitted the message. */
	uid: string;
}

/** A history read, as Flue sent it. */
export interface HistoryRead {
	body: string;
	/** The parsed snapshot. A page of older messages (`before`) has none. */
	history?: FlueHistory | undefined;
	headers: Headers;
}

/** A window of history; each value is passed to Flue as given. */
export interface HistoryWindow {
	limit?: string | undefined;
	from?: string | undefined;
	before?: string | undefined;
}

/** A `view=updates` read. Without `live`, Flue answers one JSON page. */
export interface UpdatesRead {
	offset: string;
	live?: "long-poll" | "sse" | undefined;
	cursor?: string | undefined;
	from?: string | undefined;
	limit?: string | undefined;
}

/**
 * The sidecar refused or could not be reached. The message never carries
 * the response body, which names the conversation.
 */
export class SidecarError extends Error {
	public override readonly name = "SidecarError";

	/** The sidecar's status, `undefined` when no usable answer arrived. */
	public readonly status: number | undefined;

	/** Flue's `error.type` of a 4xx answer, such as `agent_instance_not_found`. */
	public readonly type: string | undefined;

	public constructor(
		message: string,
		status: number | undefined,
		options?: ErrorOptions & { type?: string | undefined },
	) {
		super(`[payloadcms-flue] ${message}`, options);
		this.status = status;
		this.type = options?.type;
	}
}

// The `error.type` of a refusal; nothing else of the body is kept.
const errorType = async (response: Response): Promise<string | undefined> => {
	try {
		const body: unknown = await response.json();
		const error = isRecord(body) ? body["error"] : undefined;

		return isRecord(error) && typeof error["type"] === "string"
			? error["type"]
			: undefined;
	} catch {
		return undefined;
	}
};

export interface SidecarClientOptions {
	url: string;
	secret: string;
	fetch?: typeof fetch;
	/** How long a request may take, 10 seconds by default. A long poll gets 45 seconds for its headers. */
	timeoutMs?: number;
}

// Flue holds a long poll for up to 30 seconds before it answers.
const LONG_POLL_HEADERS_MS = 45_000;

/*
 * How long a request may take. By default the deadline covers the whole
 * answer; with `until: "headers"` it ends once the headers arrive, so a
 * streamed body may outlast it.
 */
interface Deadline {
	ms: number;
	until?: "headers";
}

// The parameters that are set, in the order given.
const query = (params: Record<string, string | undefined>): string =>
	new URLSearchParams(
		Object.entries(params).filter(
			(entry): entry is [string, string] => entry[1] !== undefined,
		),
	).toString();

const isHistory = (value: unknown): value is FlueHistory =>
	isRecord(value) &&
	typeof value["offset"] === "string" &&
	Array.isArray(value["messages"]) &&
	Array.isArray(value["settlements"]);

/**
 * The sidecar's conversation API, as Payload calls it. Every request carries
 * only the headers built here and the shared secret.
 */
export const createSidecarClient = ({
	url,
	secret,
	fetch: fetchFn = fetch,
	timeoutMs = 10_000,
}: SidecarClientOptions) => {
	const base = url.replace(/\/+$/, "");
	const conversation = (agent: string, conversationId: string): string =>
		`${base}/agents/${encodeURIComponent(agent)}/${encodeURIComponent(conversationId)}`;

	// Every request has a deadline; a caller's `signal` applies as well.
	const request = async (
		target: string,
		{
			headers,
			deadline = { ms: timeoutMs },
			signal,
			...init
		}: Omit<RequestInit, "headers" | "signal"> & {
			headers: Record<string, string>;
			deadline?: Deadline;
			signal?: AbortSignal | undefined;
		},
	): Promise<Response> => {
		const headersOnly = deadline.until === "headers";
		const timer = headersOnly ? new AbortController() : undefined;
		const expired = timer?.signal ?? AbortSignal.timeout(deadline.ms);
		const pending =
			timer &&
			setTimeout(() => {
				timer.abort();
			}, deadline.ms);
		let response: Response;

		try {
			response = await fetchFn(target, {
				...init,
				headers: { ...headers, authorization: `Bearer ${secret}` },
				signal: signal ? AbortSignal.any([expired, signal]) : expired,
			});
		} catch (error) {
			throw new SidecarError(
				expired.aborted
					? "The sidecar did not answer in time."
					: "The sidecar could not be reached.",
				undefined,
				{ cause: error },
			);
		} finally {
			clearTimeout(pending);
		}

		if (!response.ok) {
			const type =
				response.status < 500 ? await errorType(response) : undefined;

			await response.body?.cancel().catch(() => undefined);

			throw new SidecarError(
				`The sidecar answered ${String(response.status)}.`,
				response.status,
				{ type },
			);
		}

		return response;
	};

	// The body as text and, where it parses, as JSON.
	const readBody = async (
		response: Response,
	): Promise<{ text: string; json: unknown }> => {
		let text: string;

		try {
			text = await response.text();
		} catch (error) {
			throw new SidecarError("The sidecar's answer broke off.", undefined, {
				cause: error,
			});
		}

		try {
			return { text, json: JSON.parse(text) as unknown };
		} catch {
			return { text, json: undefined };
		}
	};

	return {
		/** Posts one message, creating the conversation on first use. */
		send: async (
			agent: string,
			conversationId: string,
			{ message, uid, initialData }: SendArgs,
		): Promise<Submission> => {
			const response = await request(conversation(agent, conversationId), {
				method: "POST",
				headers: {
					accept: "application/json",
					"content-type": "application/json",
				},
				body: JSON.stringify({ ...message, uid, initialData }),
			});
			const { json: body } = await readBody(response);

			if (
				!isRecord(body) ||
				typeof body["offset"] !== "string" ||
				typeof body["submissionId"] !== "string" ||
				typeof body["uid"] !== "string"
			) {
				throw new SidecarError(
					"The sidecar admitted the message without a submission.",
					undefined,
				);
			}

			return {
				offset: body["offset"],
				submissionId: body["submissionId"],
				uid: body["uid"],
			};
		},

		/** The conversation's history, `undefined` when Flue has never seen it. */
		history: async (
			agent: string,
			conversationId: string,
			{
				limit,
				from,
				before,
				signal,
			}: HistoryWindow & { signal?: AbortSignal | undefined } = {},
		): Promise<HistoryRead | undefined> => {
			let response: Response;

			try {
				response = await request(
					`${conversation(agent, conversationId)}?${query({ view: "history", limit, from, before })}`,
					{
						method: "GET",
						headers: { accept: "application/json" },
						signal,
					},
				);
			} catch (error) {
				if (error instanceof SidecarError && error.status === 404) {
					return undefined;
				}

				throw error;
			}

			const { text, json } = await readBody(response);
			const unreadable = () =>
				new SidecarError("The sidecar sent an unreadable history.", undefined);

			if (before !== undefined) {
				if (!isRecord(json) || !Array.isArray(json["messages"])) {
					throw unreadable();
				}

				return { body: text, headers: response.headers };
			}

			if (!isHistory(json)) {
				throw unreadable();
			}

			return { body: text, history: json, headers: response.headers };
		},

		/**
		 * The updates from `offset`, as the sidecar's response. The deadline
		 * ends with the headers, which a long poll holds until data arrives.
		 */
		updates: (
			agent: string,
			conversationId: string,
			{
				offset,
				live,
				cursor,
				from,
				limit,
				signal,
			}: UpdatesRead & { signal?: AbortSignal | undefined },
		): Promise<Response> =>
			request(
				`${conversation(agent, conversationId)}?${query({ view: "updates", offset, live, cursor, from, limit })}`,
				{
					method: "GET",
					headers: {
						accept: live === "sse" ? "text/event-stream" : "application/json",
					},
					deadline: {
						ms: live === "long-poll" ? LONG_POLL_HEADERS_MS : timeoutMs,
						until: "headers",
					},
					signal,
				},
			),

		/** Stops the conversation's run. `aborted` is false when none was live. */
		abort: async (
			agent: string,
			conversationId: string,
		): Promise<{ aborted: boolean }> => {
			const response = await request(
				`${conversation(agent, conversationId)}/abort`,
				{
					method: "POST",
					headers: { accept: "application/json" },
				},
			);
			const { json } = await readBody(response);

			return { aborted: isRecord(json) && json["aborted"] === true };
		},
	};
};
