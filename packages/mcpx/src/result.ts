import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

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
