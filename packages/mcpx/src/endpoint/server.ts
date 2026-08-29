import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { toToolError } from "./errors.js";
import { BUILTIN_TOOLS } from "../tools/index.js";

import type { NormalizedOptions } from "../options.js";
import type { McpxAnyTool, McpxToolScope } from "../types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * Builds a tool's input schema as a strict object, so an unknown argument is
 * rejected with its name instead of being silently stripped and the tool
 * answering as if it had not been passed. A tool may build its shape from the
 * scope to narrow enums to what the key may touch.
 */
export const toolInputSchema = (
	tool: McpxAnyTool,
	scope: McpxToolScope,
): z.ZodObject =>
	z.strictObject(
		typeof tool.inputSchema === "function"
			? tool.inputSchema(scope)
			: (tool.inputSchema ?? {}),
	);

/**
 * Whether the key may call the tool. A tool that does not decide for itself is
 * gated by its own checkbox on the key, which is how the tools from
 * `options.tools` work; the builtins derive it from the key's collection and
 * global capabilities instead.
 */
export const isToolEnabled = (
	tool: McpxAnyTool,
	scope: McpxToolScope,
): boolean =>
	tool.isEnabled
		? tool.isEnabled(scope)
		: scope.capabilities.tools[tool.name] === true;

/**
 * Builds the MCP server for one request. Builtin and configured tools take the
 * same route: each is registered against the key's capabilities, so
 * `tools/list` shows exactly what the key may call and every `collection` enum
 * is limited to what it may touch.
 */
export const createMcpServer = (
	scope: McpxToolScope,
	options: NormalizedOptions,
): McpServer => {
	const { req } = scope;
	const { logger } = req.payload;

	const server = new McpServer(
		{ name: options.serverInfo.name, version: options.serverInfo.version },
		{
			instructions:
				"Start with listCapabilities, then describeSchema for the collection or global you work on. Writes always land as drafts; a human publishes.",
		},
	);

	const guarded =
		(run: () => CallToolResult | Promise<CallToolResult>) =>
		async (): Promise<CallToolResult> => {
			try {
				return await run();
			} catch (error) {
				return toToolError(error, logger);
			}
		};

	for (const tool of [...BUILTIN_TOOLS, ...options.tools]) {
		if (!isToolEnabled(tool, scope)) {
			continue;
		}

		server.registerTool(
			tool.name,
			{
				description: tool.description,
				inputSchema: toolInputSchema(tool, scope),
				...(tool.annotations ? { annotations: tool.annotations } : {}),
			},
			(args, extra) =>
				guarded(() =>
					tool.handler({ args: args as never, scope, req, extra }),
				)(),
		);
	}

	return server;
};
