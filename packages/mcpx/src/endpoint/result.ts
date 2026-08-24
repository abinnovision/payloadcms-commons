import { APIError, ValidationError } from "payload";

import { pointerFromPayloadPath } from "../schema/walk.js";

import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Payload } from "payload";

type Logger = Payload["logger"];

/**
 * A JSON-RPC error response for failures that happen before the MCP server
 * is involved (auth, method, body parsing).
 */
const jsonRpcError = (args: {
	status: number;
	code: number;
	message: string;
	headers?: HeadersInit;
}): Response => {
	const headers = new Headers(args.headers);

	headers.set("content-type", "application/json");

	return new Response(
		JSON.stringify({
			jsonrpc: "2.0",
			id: null,
			error: { code: args.code, message: args.message },
		}),
		{ status: args.status, headers },
	);
};

/**
 * A successful tool result carrying `value` as JSON text.
 */
const jsonResult = (value: unknown): CallToolResult => ({
	content: [{ type: "text", text: JSON.stringify(value) }],
});

/**
 * A failed tool result. `extras` travel alongside the message so the client
 * can act on them (problems, validation errors, the current `updatedAt`).
 */
const errorResult = (
	message: string,
	extras: Record<string, unknown> = {},
): CallToolResult => ({
	content: [
		{ type: "text", text: JSON.stringify({ error: message, ...extras }) },
	],
	isError: true,
});

/**
 * Maps an exception thrown by a tool to a result the client can read.
 *
 * Payload's public errors keep their message and status; a `ValidationError`
 * also surfaces its per-field detail, with each field's path restated as a
 * JSON Pointer so it reads like every other path this plugin reports. Anything
 * else is logged and reported as an internal error so no stack or driver
 * message leaks to the client.
 */
const toToolError = (error: unknown, logger: Logger): CallToolResult => {
	if (error instanceof ValidationError) {
		return errorResult(error.message, {
			status: error.status,
			validationErrors: error.data.errors.map((entry) => ({
				...entry,
				path: pointerFromPayloadPath(entry.path),
			})),
		});
	}

	if (error instanceof APIError && error.isPublic) {
		return errorResult(error.message, { status: error.status });
	}

	logger.error({ err: error, msg: "[payloadcms-mcpx] Tool call failed." });

	return errorResult("Internal error");
};

export { errorResult, jsonResult, jsonRpcError, toToolError };
