import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * A successful tool result carrying `value` as JSON text.
 */
export const jsonResult = (value: unknown): CallToolResult => ({
	content: [{ type: "text", text: JSON.stringify(value) }],
});

/**
 * A failed tool result. `extras` travel alongside the message so the client
 * can act on them (problems, validation errors, the current `updatedAt`).
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
