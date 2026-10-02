import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { toToolError } from "./errors.js";
import { BUILTIN_TOOLS } from "../tools/builtin.js";
import { draftSentence } from "../tools/shared.js";

import type { NormalizedOptions } from "../options.js";
import type { McpxAnyTool, McpxToolScope } from "../types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** Strict, so an unknown argument is rejected by name instead of stripped. */
export const toolInputSchema = (
	tool: McpxAnyTool,
	scope: McpxToolScope,
): z.ZodObject =>
	z.strictObject(
		typeof tool.inputSchema === "function"
			? tool.inputSchema(scope)
			: (tool.inputSchema ?? {}),
	);

// May be built from the scope, to name the entities this key writes live.
const toolDescription = (tool: McpxAnyTool, scope: McpxToolScope): string =>
	typeof tool.description === "function"
		? tool.description(scope)
		: tool.description;

/** A tool that does not decide for itself is gated by its own checkbox. */
export const isToolEnabled = (
	tool: McpxAnyTool,
	scope: McpxToolScope,
): boolean =>
	tool.isEnabled
		? tool.isEnabled(scope)
		: scope.capabilities.tools[tool.name] === true;

/**
 * One server per request. Builtin and configured tools take the same route,
 * each registered against the key's capabilities, so `tools/list` shows exactly
 * what the key may call.
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
			instructions: `Start with listCapabilities, then describeSchema for the collection or global you work on. ${draftSentence(scope)}`,
		},
	);

	for (const tool of [...BUILTIN_TOOLS, ...options.tools]) {
		if (!isToolEnabled(tool, scope)) {
			continue;
		}

		server.registerTool(
			tool.name,
			{
				description: toolDescription(tool, scope),
				inputSchema: toolInputSchema(tool, scope),
				...(tool.annotations ? { annotations: tool.annotations } : {}),
			},
			async (args, extra): Promise<CallToolResult> => {
				try {
					return await tool.handler({ args: args as never, scope, req, extra });
				} catch (error) {
					return toToolError(error, logger);
				}
			},
		);
	}

	return server;
};
