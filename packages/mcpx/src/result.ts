import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * The JSON of a result's first text block. Other text comes back as `{ text }`.
 */
export const parseResult = (
	result: CallToolResult,
): Record<string, unknown> => {
	const [first] = result.content;

	try {
		return first?.type === "text"
			? (JSON.parse(first.text) as Record<string, unknown>)
			: {};
	} catch {
		return { text: first?.type === "text" ? first.text : undefined };
	}
};

export const jsonResult = (value: unknown): CallToolResult => ({
	content: [{ type: "text", text: JSON.stringify(value) }],
});

/**
 * `extras` carries data the client can act on, such as problems, validation
 * errors or the current `updatedAt`.
 */
export const errorResult = (
	message: string,
	extras: Record<string, unknown> = {},
): CallToolResult => ({
	content: [
		{ type: "text", text: JSON.stringify({ error: message, ...extras }) },
	],
	isError: true,
});
