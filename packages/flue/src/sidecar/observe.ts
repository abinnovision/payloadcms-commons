import { createParser } from "eventsource-parser";

import {
	lastTitle,
	parseStreamEvent,
	settledOutcome,
	TITLE_PART,
} from "../protocol/events.js";

import type { NormalizedOptions } from "../options.js";
import type {
	FlueHistory,
	FlueSettlement,
	FlueStreamEvent,
} from "../protocol/events.js";
import type { EventSourceMessage } from "eventsource-parser";
import type { DefaultDocumentIDType, PayloadRequest } from "payload";

const TITLE_MAX = 120;

type ThreadSettings = Pick<NormalizedOptions, "threads">;

/**
 * Passes the bytes of an updates read through unchanged while reading Flue's
 * events from them: SSE (`live=sse`), or one JSON array of chunks otherwise.
 * An SSE chunk is held until `onEvent` has handled the events it completes;
 * a JSON page is read at its end, so the response ends after its writes. A
 * failing callback or malformed data goes to `onError` and never breaks the
 * stream.
 */
export const observeStream = (
	onEvent: (event: FlueStreamEvent) => unknown,
	onError: (error: unknown) => void,
	format: "json" | "sse" = "sse",
): TransformStream<Uint8Array, Uint8Array> => {
	const decoder = new TextDecoder();
	const messages: Pick<EventSourceMessage, "data" | "event">[] = [];
	const parser = createParser({
		onEvent: (message) => {
			messages.push(message);
		},
	});
	let page = "";

	const handle = async (): Promise<void> => {
		for (const { event, data } of messages.splice(0)) {
			let events: FlueStreamEvent[] = [];

			try {
				events = parseStreamEvent(event ?? "message", data);
			} catch (error) {
				onError(error);
			}

			for (const parsed of events) {
				try {
					// eslint-disable-next-line no-await-in-loop
					await onEvent(parsed);
				} catch (error) {
					onError(error);
				}
			}
		}
	};

	if (format === "json") {
		return new TransformStream({
			transform: (chunk, controller) => {
				page += decoder.decode(chunk, { stream: true });
				controller.enqueue(chunk);
			},
			flush: async () => {
				page += decoder.decode();

				if (page !== "") {
					// A page carries the chunks of one `data` event.
					messages.push({ event: "data", data: page });
					await handle();
				}
			},
		});
	}

	return new TransformStream({
		transform: async (chunk, controller) => {
			parser.feed(decoder.decode(chunk, { stream: true }));
			await handle();
			controller.enqueue(chunk);
		},
		flush: async () => {
			parser.feed(decoder.decode());
			await handle();
		},
	});
};

/**
 * Sets the thread's status from a settlement, only while the thread runs
 * that submission. The update is conditional in the database, so an archive
 * or a newer turn since the read stands. Returns whether the row changed.
 */
export const settleThread = async (
	req: PayloadRequest,
	settings: ThreadSettings,
	thread: DefaultDocumentIDType,
	settlement: Pick<FlueSettlement, "outcome" | "submissionId">,
): Promise<boolean> => {
	const settled: unknown = await req.payload.db.updateOne({
		collection: settings.threads.slug,
		where: {
			and: [
				{ id: { equals: thread } },
				{ lastSubmissionId: { equals: settlement.submissionId } },
				{ status: { equals: "running" } },
			],
		},
		data: { status: settledOutcome(settlement) },
		options: { atomic: true },
		req,
	});

	return Boolean(settled);
};

/**
 * Sets the title an agent wrote, cut to the field's length, and records it
 * as the agent's, so a later rename by the user can be told apart from it.
 * The update is conditional in the database and writes only these two
 * fields, so an archive since the read stands.
 */
const retitleThread = async (
	req: PayloadRequest,
	settings: ThreadSettings,
	thread: DefaultDocumentIDType,
	title: string,
): Promise<void> => {
	const cut = title.slice(0, TITLE_MAX);

	await req.payload.db.updateOne({
		collection: settings.threads.slug,
		where: {
			and: [{ id: { equals: thread } }, { status: { not_equals: "archived" } }],
		},
		data: { title: cut, agentTitle: cut },
		options: { atomic: true },
		req,
	});
};

/** The fields of a thread row that reconciliation reads. */
export interface ReconciledThread {
	id: DefaultDocumentIDType;
	status?: null | string;
	lastSubmissionId?: null | string;
	agentTitle?: null | string;
}

/** What a history snapshot changes on a row; an unset field changes nothing. */
export interface Reconciliation {
	settlement?: FlueSettlement | undefined;
	title?: string | undefined;
}

/**
 * The changes that bring the row in line with a history snapshot: the
 * settlement of its current submission while it runs, and the last title the
 * agent wrote unless that is the one already applied, so a rename stands.
 */
export const reconciliationOf = (
	thread: ReconciledThread,
	history: Pick<FlueHistory, "messages" | "settlements">,
): Reconciliation => {
	const settlement =
		thread.status === "running"
			? history.settlements.find(
					(candidate) => candidate.submissionId === thread.lastSubmissionId,
				)
			: undefined;
	const title = lastTitle(history)?.slice(0, TITLE_MAX);

	return {
		settlement,
		title: title === thread.agentTitle ? undefined : title,
	};
};

/** Writes a {@link reconciliationOf} result to the row. */
export const applyReconciliation = async (
	req: PayloadRequest,
	settings: ThreadSettings,
	thread: DefaultDocumentIDType,
	{ settlement, title }: Reconciliation,
): Promise<void> => {
	if (settlement) {
		await settleThread(req, settings, thread, settlement);
	}

	if (title !== undefined) {
		await retitleThread(req, settings, thread, title);
	}
};

/**
 * Applies one observed event to the thread row: a title part sets the
 * title, a settlement of the thread's current submission sets its status,
 * and a reset reconciles the row with its snapshot as a history read does.
 * `req` is an internal request, which may change the status.
 */
export const applyObservation = async (
	req: PayloadRequest,
	settings: ThreadSettings,
	thread: DefaultDocumentIDType,
	event: FlueStreamEvent,
): Promise<void> => {
	if (
		event.type === "data-part" &&
		event.name === TITLE_PART &&
		typeof event.data === "string" &&
		event.data !== ""
	) {
		await retitleThread(req, settings, thread, event.data);
	} else if (event.type === "submission-settled") {
		await settleThread(req, settings, thread, event);
	} else if (event.type === "conversation-reset") {
		const row = (await req.payload.findByID({
			collection: settings.threads.slug,
			id: thread,
			depth: 0,
			overrideAccess: true,
			showHiddenFields: true,
			disableErrors: true,
			select: { status: true, lastSubmissionId: true, agentTitle: true },
			req,
		})) as null | ReconciledThread;

		if (row) {
			await applyReconciliation(
				req,
				settings,
				thread,
				reconciliationOf(row, event.snapshot),
			);
		}
	}
};
