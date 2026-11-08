import { endpointHandler, isDocumentId, refusal, requireUser } from "./http.js";
import { createSidecarClient, SidecarError } from "../sidecar/client.js";
import {
	applyObservation,
	applyReconciliation,
	observeStream,
	reconciliationOf,
} from "../sidecar/observe.js";
import { internalRequest } from "../turn.js";

import type { FlueHistory } from "../protocol/events.js";
import type { PluginSettings, ThreadDoc, TurnUser } from "../turn.js";
import type { PayloadHandler, PayloadRequest } from "payload";

const NO_CONVERSATION = "The conversation does not exist.";
// Flue's cursors are opaque: word characters and the punctuation of base64 and dotted tokens.
const CURSOR = /^[\w.~=+/-]{1,2048}$/;

// The query parameters forwarded to Flue, each with the shape it must have.
const PARAMS = {
	offset: /^(?:-1|\d{1,32}_\d{1,32})$/,
	live: /^(?:long-poll|sse)$/,
	cursor: CURSOR,
	from: CURSOR,
	before: CURSOR,
	limit: /^[1-9]\d{0,5}$/,
} as const;

type Param = keyof typeof PARAMS;

const VIEW_PARAMS = {
	history: ["limit", "from", "before"],
	updates: ["offset", "live", "cursor", "from", "limit"],
} as const satisfies Record<string, readonly Param[]>;

// The response headers of a read that the Flue client acts on.
const STREAM_HEADERS = [
	"Stream-Next-Offset",
	"Stream-Up-To-Date",
	"Stream-Cursor",
	"Stream-Closed",
];

/*
 * The sidecar statuses the Flue client acts on, each with a body of its own:
 * the sidecar's body names the conversation. Any other refusal is a 502.
 */
const UPSTREAM_REFUSALS: Partial<Record<number, string>> = {
	400: "The agent sidecar refused the request as malformed.",
	404: NO_CONVERSATION,
	410: "The history cursor is no longer valid.",
	416: "The offset is past the end of the conversation.",
};

// The view's parameters that are set, or the reason one is refused. Others are not forwarded.
const readQuery = (
	params: URLSearchParams,
	names: readonly Param[],
): Partial<Record<Param, string>> | string => {
	const query: Partial<Record<Param, string>> = {};

	for (const name of names) {
		const value = params.get(name);

		if (value === null) {
			continue;
		}

		if (!PARAMS[name].test(value)) {
			return `${name} is malformed.`;
		}

		query[name] = value;
	}

	return query;
};

/*
 * The answer's headers: the content type of the view rather than the
 * sidecar's, and the stream headers, which a client on another origin may
 * read.
 */
const forwarded = (
	upstream: Headers,
	headers: Record<string, string>,
): Headers => {
	const result = new Headers({
		...headers,
		"access-control-expose-headers": STREAM_HEADERS.join(", "),
		"x-content-type-options": "nosniff",
	});

	for (const name of STREAM_HEADERS) {
		const value = upstream.get(name);

		if (value !== null) {
			result.set(name, value);
		}
	}

	return result;
};

// The internal request, as the reader, that writes to the thread.
const threadRequest = (
	req: PayloadRequest,
	user: TurnUser,
	thread: ThreadDoc,
): Promise<PayloadRequest> =>
	internalRequest(req.payload, user, {
		agent: thread.agent,
		thread: thread.id,
		kind: thread.kind ?? "chat",
	});

/*
 * Brings the row in line with history (see `reconciliationOf`). A failed
 * write is logged; the history is answered regardless.
 */
const reconcile = async (
	req: PayloadRequest,
	settings: PluginSettings,
	thread: ThreadDoc,
	user: TurnUser,
	history: FlueHistory,
): Promise<void> => {
	const reconciliation = reconciliationOf(thread, history);

	if (!reconciliation.settlement && reconciliation.title === undefined) {
		return;
	}

	try {
		await applyReconciliation(
			await threadRequest(req, user, thread),
			settings,
			thread.id,
			reconciliation,
		);
	} catch (error) {
		req.payload.logger.error({
			err: error,
			msg: "[payloadcms-flue] Could not reconcile a thread with its history.",
		});
	}
};

/**
 * `GET {base}/c/:thread?view=history|updates`: the thread's Flue
 * conversation route, for a user who can read the thread. Bodies and stream
 * headers pass through as Flue sent them; reading them updates the row's
 * status and title.
 */
export const conversationHandler = (settings: PluginSettings): PayloadHandler =>
	endpointHandler(async (req) => {
		const user = requireUser(req, settings.mcpx.userCollection);

		if (user instanceof Response) {
			return user;
		}

		const view = req.searchParams.get("view");

		if (view !== "history" && view !== "updates") {
			return refusal(400, "view must be history or updates.");
		}

		const query = readQuery(req.searchParams, VIEW_PARAMS[view]);

		if (typeof query === "string") {
			return refusal(400, query);
		}

		const { offset, live, cursor, from, before, limit } = query;

		if (view === "updates" && offset === undefined) {
			return refusal(400, "offset must be a stream offset.");
		}

		const id = req.routeParams?.["thread"];
		const thread = isDocumentId(req, id)
			? ((await req.payload.findByID({
					collection: settings.threads.slug,
					id,
					depth: 0,
					overrideAccess: false,
					showHiddenFields: true,
					disableErrors: true,
					req,
				})) as null | ThreadDoc)
			: null;

		if (!thread?.conversationId) {
			return refusal(404, "The thread does not exist.");
		}

		const client = createSidecarClient(settings.sidecar);

		try {
			// Only a history read comes without an offset.
			if (offset === undefined) {
				// A reader that goes away cancels the upstream read.
				const read = await client.history(thread.agent, thread.conversationId, {
					limit,
					from,
					before,
					signal: req.signal,
				});

				if (!read) {
					return refusal(404, NO_CONVERSATION);
				}

				if (read.history) {
					await reconcile(req, settings, thread, user, read.history);
				}

				return new Response(read.body, {
					headers: forwarded(read.headers, {
						"content-type": "application/json",
						"cache-control": "no-store",
					}),
				});
			}

			const upstream = await client.updates(
				thread.agent,
				thread.conversationId,
				{
					offset,
					live: live === "long-poll" || live === "sse" ? live : undefined,
					cursor,
					from,
					limit,
					signal: req.signal,
				},
			);

			if (!upstream.body) {
				return refusal(502, "The agent sidecar sent no updates.");
			}

			const internal = await threadRequest(req, user, thread);
			const observer = observeStream(
				(event) => applyObservation(internal, settings, thread.id, event),
				(error) => {
					req.payload.logger.error({
						err: error,
						msg: "[payloadcms-flue] Could not apply a stream event to its thread.",
					});
				},
				live === "sse" ? "sse" : "json",
			);

			return new Response(upstream.body.pipeThrough(observer), {
				headers: forwarded(upstream.headers, {
					"content-type":
						live === "sse" ? "text/event-stream" : "application/json",
					"cache-control": "no-store, no-transform",
					"x-accel-buffering": "no",
				}),
			});
		} catch (error) {
			if (!(error instanceof SidecarError)) {
				throw error;
			}

			const { status } = error;
			const message =
				status === undefined ? undefined : UPSTREAM_REFUSALS[status];

			return status !== undefined && message !== undefined
				? refusal(status, message)
				: refusal(502, "The agent sidecar could not be reached.");
		}
	});
