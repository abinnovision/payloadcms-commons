import { isUserTurn, readUserTurnBody } from "../protocol/context.js";
import { TITLE_PART } from "../protocol/events.js";
import { isRecord } from "../protocol/guards.js";

import type { ThreadMessageLike } from "@assistant-ui/react";
import type {
	FlueConversationMessage,
	FlueConversationPart,
	FlueConversationState,
} from "@flue/sdk";

type Part = Exclude<ThreadMessageLike["content"], string>[number];
type ToolArgs = NonNullable<Extract<Part, { type: "tool-call" }>["args"]>;
type Attachment = NonNullable<ThreadMessageLike["attachments"]>[number];

const OUTCOME_TEXT = {
	failed: "The run failed.",
	aborted: "The run was stopped.",
} as const;

// A user's turn reaches Flue as the context signal, its body the message.
const isTurn = (message: FlueConversationMessage): boolean =>
	message.purpose === "dispatch" &&
	isUserTurn(message.signal?.attributes ?? {});

/*
 * User turns, visible answers and the advisory that marks a failed or
 * aborted submission. Other signals and advisories are runtime plumbing.
 */
const isShown = (message: FlueConversationMessage): boolean =>
	isTurn(message) ||
	message.settlement !== undefined ||
	(message.role !== "system" && message.display === "visible");

const textOf = (message: FlueConversationMessage): string =>
	message.parts.map((part) => (part.type === "text" ? part.text : "")).join("");

/*
 * A user's file as an attachment: an image shows from its URL, any other
 * file links to it. A file whose bytes cannot be resolved yet is left out.
 */
const attachmentsOf = (message: FlueConversationMessage): Attachment[] =>
	message.parts.flatMap((part, index): Attachment[] => {
		if (part.type !== "file" || part.url === undefined) {
			return [];
		}

		const image = part.mediaType.startsWith("image/");
		const name = part.filename ?? (image ? "Image" : "Document");

		return [
			{
				id: part.id ?? `${message.id}:${String(index)}`,
				type: image ? "image" : "document",
				name,
				contentType: part.mediaType,
				status: { type: "complete" },
				content: [
					image
						? { type: "image", image: part.url, filename: name }
						: {
								type: "file",
								data: part.url,
								mimeType: part.mediaType,
								filename: name,
							},
				],
			},
		];
	});

// Titles reach the thread list through the threads collection instead.
const partsOf = (part: FlueConversationPart): Part[] => {
	switch (part.type) {
		case "text":
		case "reasoning":
			return [{ type: part.type, text: part.text }];
		case "dynamic-tool": {
			const call = {
				type: "tool-call",
				toolCallId: part.toolCallId,
				toolName: part.toolName,
				args: (isRecord(part.input) ? part.input : {}) as ToolArgs,
			} as const;

			if (part.state === "output-available") {
				return [{ ...call, result: part.output }];
			}

			return part.state === "output-error"
				? [{ ...call, result: part.errorText, isError: true }]
				: [call];
		}

		case "file":
			return [];
		default:
			return part.type === `data-${TITLE_PART}`
				? []
				: [{ type: part.type, data: part.data }];
	}
};

/**
 * The messages a thread shows, in order. The SDK replaces only the message a
 * chunk changes, so the elements keep their identity across snapshots and
 * the runtime's converter cache, keyed by message, converts only that one.
 */
export const shownMessages = (
	conversation: FlueConversationState | undefined,
): FlueConversationMessage[] => conversation?.messages.filter(isShown) ?? [];

/** One message of {@link shownMessages} as assistant-ui renders it. */
export const toThreadMessage = (
	message: FlueConversationMessage,
): ThreadMessageLike => {
	const base = {
		id: message.id,
		...(message.timestamp === undefined
			? {}
			: { createdAt: new Date(message.timestamp) }),
	};

	if (message.settlement !== undefined) {
		return {
			...base,
			role: "system",
			content: [
				{ type: "text", text: OUTCOME_TEXT[message.settlement.outcome] },
			],
		};
	}

	if (message.role !== "assistant") {
		// The runtime's echo of a message on its way; Flue's own messages carry no such key.
		const optimistic = message.metadata?.["isOptimistic"] === true;
		const raw = textOf(message);
		// A turn with files reaches Flue as a user message whose body starts with the context.
		const text =
			message.purpose === "user" && !optimistic
				? (readUserTurnBody(raw)?.text ?? raw)
				: raw;
		const attachments = attachmentsOf(message);

		return {
			...base,
			role: "user",
			content:
				text === "" && attachments.length > 0 ? [] : [{ type: "text", text }],
			...(attachments.length === 0 ? {} : { attachments }),
			...(optimistic ? { metadata: { isOptimistic: true } } : {}),
		};
	}

	return {
		...base,
		role: "assistant",
		content: message.parts.flatMap(partsOf),
	};
};

/** Whether the conversation has settled the submission. */
export const isSettled = (
	conversation: FlueConversationState | undefined,
	submissionId: string,
): boolean =>
	conversation?.settlements.some(
		(settlement) => settlement.submissionId === submissionId,
	) ?? false;

/**
 * Whether a submission shows on a message but not among the settlements. A
 * submission still waiting in Flue's queue does not show.
 */
export const hasRunningSubmission = (
	conversation: FlueConversationState | undefined,
): boolean =>
	conversation?.messages.some(
		(message) =>
			message.submissionId !== undefined &&
			!isSettled(conversation, message.submissionId),
	) ?? false;
