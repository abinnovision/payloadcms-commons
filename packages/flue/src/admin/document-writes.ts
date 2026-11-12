import { isRecord } from "../protocol/guards.js";

import type { FlueConversationMessage, FlueConversationPart } from "@flue/sdk";

/** The mcpx tools that change an existing document named by their arguments. */
export const WRITE_TOOLS: readonly string[] = [
	"mcp__payload__patchDocument",
	"mcp__payload__publishDocument",
];

/** The open document as mcpx's tool arguments name it. */
export interface WriteTarget {
	collection?: string | undefined;
	id?: string | undefined;
	global?: string | undefined;
}

type ToolPart = Extract<FlueConversationPart, { type: "dynamic-tool" }>;

// A call that answered without an error; an MCP error result sets `isError`.
const succeeded = (part: ToolPart): boolean =>
	part.state === "output-available" &&
	!(isRecord(part.output) && part.output["isError"] === true);

const targets = (part: ToolPart, target: WriteTarget): boolean => {
	if (!WRITE_TOOLS.includes(part.toolName) || !isRecord(part.input)) {
		return false;
	}

	const { collection, id, global } = part.input;

	if (target.global !== undefined) {
		return global === target.global && collection === undefined;
	}

	return (
		target.collection !== undefined &&
		collection === target.collection &&
		(typeof id === "string" || typeof id === "number") &&
		String(id) === target.id
	);
};

const toolParts = (messages: readonly FlueConversationMessage[]): ToolPart[] =>
	messages.flatMap((message) =>
		message.parts.filter(
			(part): part is ToolPart => part.type === "dynamic-tool",
		),
	);

/** The ids of the tool calls that have finished, with or without an error. */
export const finishedCalls = (
	messages: readonly FlueConversationMessage[],
): string[] =>
	toolParts(messages)
		.filter(
			(part) =>
				part.state === "output-available" || part.state === "output-error",
		)
		.map((part) => part.toolCallId);

/**
 * The successful calls that wrote `target` and are not in `handled`. The
 * caller adds the ones it delivered to `handled`.
 */
export const newDocumentWrites = (
	messages: readonly FlueConversationMessage[],
	handled: ReadonlySet<string>,
	target: WriteTarget | undefined,
): string[] =>
	target === undefined
		? []
		: toolParts(messages)
				.filter(
					(part) =>
						!handled.has(part.toolCallId) &&
						succeeded(part) &&
						targets(part, target),
				)
				.map((part) => part.toolCallId);
