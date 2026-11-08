import { isRecord } from "./guards.js";

/**
 * The name of the Flue data part an agent writes to set its thread's title.
 * It reaches the stream as a `data-part` chunk with this `name`, and history
 * as a `data-title` part.
 */
export const TITLE_PART = "title";

/** The status a thread row carries. */
export type ThreadStatus = "idle" | "running" | "failed" | "archived";

/** The terminal outcome of one Flue submission. */
export type SettlementOutcome = "completed" | "failed" | "aborted";

/** Ordering token of a chunk; compare `batch`, then `index`, to drop repeats. */
export interface StreamPosition {
	batch: number;
	index: number;
}

/** The caller-safe error of a failed or aborted submission. */
export interface FlueSettlementError {
	name?: string;
	message?: string;
	/** For example `internal_error` for a failure, `submission_aborted` for an abort. */
	type: string;
	details?: string;
}

/** Model text or reasoning, `streaming` while the response is live. */
export interface FlueTextPart {
	type: "text" | "reasoning";
	text: string;
	state: "streaming" | "done";
}

/** One write of a named data part, such as `data-title`. */
export interface FlueDataPart {
	type: `data-${string}`;
	data: unknown;
}

/** An attachment, served by the conversation's attachments route under `id`. */
export interface FlueFilePart {
	type: "file";
	mediaType: string;
	id?: string;
	size?: number;
	filename?: string;
}

interface ToolPartBase {
	type: "dynamic-tool";
	toolName: string;
	toolCallId: string;
	input: unknown;
}

/** A tool call; its state moves from `input-available` to an outcome. */
export type FlueToolPart =
	| (ToolPartBase & { state: "input-available" })
	| (ToolPartBase & {
			state: "output-available";
			output: unknown;
			durationMs?: number;
	  })
	| (ToolPartBase & {
			state: "output-error";
			errorText: string;
			durationMs?: number;
	  });

/** One part of a message, in the order it was written. */
export type FlueMessagePart =
	FlueTextPart | FlueDataPart | FlueFilePart | FlueToolPart;

/**
 * One message of a Flue conversation. Signals arrive as `role: "system"`
 * with `purpose: "dispatch"` and their attributes; the signal type is not
 * part of the message.
 */
export interface FlueMessage {
	id: string;
	role: "user" | "assistant" | "system";
	purpose: "user" | "assistant" | "dispatch" | "advisory";
	display: "visible" | "hidden" | "diagnostic";
	submissionId?: string;
	turnId?: string;
	timestamp?: string;
	signal?: { tagName?: string; attributes?: Record<string, string> };
	/** Set on the advisory Flue appends when a submission fails or is aborted. */
	settlement?: { outcome: "failed" | "aborted" };
	metadata?: Record<string, unknown>;
	parts: FlueMessagePart[];
}

/** One settled submission, in history and in `submission-settled` chunks. */
export interface FlueSettlement {
	submissionId: string;
	outcome: SettlementOutcome;
	error?: FlueSettlementError;
	/** The submission whose response carried this one, when it joined a live run. */
	answeredBySubmissionId?: string;
	timestamp?: string;
}

/** The body of `GET /:id?view=history`. */
export interface FlueHistory {
	v: 1;
	/** Flue's own id (`conv_…`), not the id in the conversation URL. */
	conversationId: string;
	/** Where a `view=updates` read resumes after this snapshot. */
	offset: string;
	messages: FlueMessage[];
	settlements: FlueSettlement[];
	incarnation?: string;
}

interface ChunkBase {
	conversationId: string;
	position: StreamPosition;
}

/** Opens every SSE connection. It carries no position. */
export interface StreamCheckpointChunk {
	type: "stream-checkpoint";
	incarnation: string;
}

/** Replaces all state accumulated so far, for example on a read from `-1`. */
export interface ConversationResetChunk extends ChunkBase {
	type: "conversation-reset";
	snapshot: FlueHistory;
}

/** A complete message: a user turn, a signal or an advisory. */
export interface MessageAppendedChunk extends ChunkBase {
	type: "message-appended";
	message: FlueMessage;
}

/** An assistant response opens, or continues with its next model step. */
export interface MessageStartedChunk extends ChunkBase {
	type: "message-started";
	messageId: string;
	submissionId?: string;
	turnId?: string;
	metadata?: Record<string, unknown>;
	timestamp?: string;
}

/** Agent-authored metadata to merge onto an open response. */
export interface MessageMetadataChunk extends ChunkBase {
	type: "message-metadata";
	messageId: string;
	metadata: Record<string, unknown>;
}

/** Streamed text or reasoning for the open part of that kind. */
export interface MessageDeltaChunk extends ChunkBase {
	type: "message-delta";
	messageId: string;
	kind: "text" | "reasoning";
	delta: string;
}

/** A tool call the model made, matched to its outcome by `toolCallId`. */
export interface ToolInputChunk extends ChunkBase {
	type: "tool-input";
	messageId: string;
	toolCallId: string;
	toolName: string;
	input: unknown;
	timestamp?: string;
}

/** The result of a tool call. */
export interface ToolOutputChunk extends ChunkBase {
	type: "tool-output";
	toolCallId: string;
	output: unknown;
	durationMs?: number;
	timestamp?: string;
}

/** A tool threw. The submission goes on and the model sees the error. */
export interface ToolOutputErrorChunk extends ChunkBase {
	type: "tool-output-error";
	toolCallId: string;
	errorText: string;
	durationMs?: number;
	timestamp?: string;
}

/** One write of a named data part; `name` is without the `data-` prefix. */
export interface DataPartChunk extends ChunkBase {
	type: "data-part";
	messageId: string;
	name: string;
	data: unknown;
}

/** A model step of the response ends; more steps may follow. */
export interface MessageCompletedChunk extends ChunkBase {
	type: "message-completed";
	messageId: string;
	timestamp?: string;
}

/** The terminal outcome of one submission, named by the 202's `submissionId`. */
export interface SubmissionSettledChunk extends ChunkBase, FlueSettlement {
	type: "submission-settled";
}

/** A chunk of a `view=updates` read, as Flue's projection emits it. */
export type FlueStreamChunk =
	| StreamCheckpointChunk
	| ConversationResetChunk
	| MessageAppendedChunk
	| MessageStartedChunk
	| MessageMetadataChunk
	| MessageDeltaChunk
	| ToolInputChunk
	| ToolOutputChunk
	| ToolOutputErrorChunk
	| DataPartChunk
	| MessageCompletedChunk
	| SubmissionSettledChunk;

/**
 * A `control` event. `streamNextOffset` is the offset to reconnect from; SSE
 * lines carry no `id:`.
 */
export interface FlueStreamControl {
	type: "control";
	streamNextOffset: string;
	upToDate: boolean;
}

/** What {@link parseStreamEvent} yields. */
export type FlueStreamEvent = FlueStreamChunk | FlueStreamControl;

const CHUNK_TYPES: ReadonlySet<string> = new Set<FlueStreamChunk["type"]>([
	"stream-checkpoint",
	"conversation-reset",
	"message-appended",
	"message-started",
	"message-metadata",
	"message-delta",
	"tool-input",
	"tool-output",
	"tool-output-error",
	"data-part",
	"message-completed",
	"submission-settled",
]);

/**
 * The events in one SSE message, given its event name and data. A `data`
 * event yields its chunks in order, a `control` event yields one control.
 * Unknown event names and chunk types yield nothing; malformed data throws.
 */
export const parseStreamEvent = (
	event: string,
	data: string,
): FlueStreamEvent[] => {
	if (event === "data") {
		const chunks: unknown = JSON.parse(data);

		if (!Array.isArray(chunks)) {
			throw new TypeError("A Flue data event must carry a JSON array.");
		}

		return chunks.filter(
			(chunk): chunk is FlueStreamChunk =>
				isRecord(chunk) &&
				typeof chunk["type"] === "string" &&
				CHUNK_TYPES.has(chunk["type"]),
		);
	}

	if (event === "control") {
		const control: unknown = JSON.parse(data);

		if (!isRecord(control) || typeof control["streamNextOffset"] !== "string") {
			throw new TypeError(
				"A Flue control event must carry a streamNextOffset.",
			);
		}

		return [
			{
				type: "control",
				streamNextOffset: control["streamNextOffset"],
				upToDate: control["upToDate"] === true,
			},
		];
	}

	return [];
};

/**
 * The thread status a settled submission leaves. An abort is a deliberate
 * stop, so the thread is idle again; a failure of any kind is `failed`.
 */
export const settledOutcome = (
	settlement: Pick<FlueSettlement, "outcome">,
): Extract<ThreadStatus, "failed" | "idle"> =>
	settlement.outcome === "failed" ? "failed" : "idle";

/** The last non-empty title an agent wrote, if history carries one. */
export const lastTitle = (
	history: Pick<FlueHistory, "messages">,
): string | undefined => {
	let title: string | undefined;

	for (const message of history.messages) {
		for (const part of message.parts) {
			if (
				part.type === `data-${TITLE_PART}` &&
				"data" in part &&
				typeof part.data === "string" &&
				part.data !== ""
			) {
				title = part.data;
			}
		}
	}

	return title;
};
