import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { toToolError } from "./result.js";
import { BUILTIN_TOOLS } from "../tools/index.js";

import type { BuiltinTool, ToolScope } from "../tools/types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * Builds a builtin tool's input schema as a strict object, so an unknown
 * argument is rejected with its name instead of being silently stripped and
 * the tool answering as if it had not been passed.
 */
const builtinInputSchema = (
	tool: BuiltinTool<never>,
	scope: ToolScope,
): z.ZodObject => z.strictObject(tool.inputSchema(scope));

/**
 * Builds the MCP server for one request. Tools are registered against the
 * key's capabilities, so `tools/list` shows exactly what the key may call and
 * every `collection` enum is limited to what it may touch.
 */
const createMcpServer = (scope: ToolScope): McpServer => {
	const { req, options, capabilities } = scope;
	const { logger } = req.payload;

	const server = new McpServer(
		{ name: options.serverInfo.name, version: options.serverInfo.version },
		{
			instructions:
				"Start with listCapabilities, then describeSchema for the collection you work on. Writes always land as drafts; a human publishes.",
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

	for (const tool of BUILTIN_TOOLS) {
		if (!tool.isEnabled(scope)) {
			continue;
		}

		server.registerTool(
			tool.name,
			{
				description: tool.description,
				inputSchema: builtinInputSchema(tool, scope),
				annotations: tool.annotations,
			},
			(args) => guarded(() => tool.handler(args as never, scope))(),
		);
	}

	for (const tool of options.tools) {
		if (capabilities.tools[tool.name] !== true) {
			continue;
		}

		server.registerTool(
			tool.name,
			{
				description: tool.description,
				inputSchema: tool.inputSchema ?? {},
				...(tool.annotations ? { annotations: tool.annotations } : {}),
			},
			(args, extra) => guarded(() => tool.handler({ args, req, extra }))(),
		);
	}

	return server;
};

export { builtinInputSchema, createMcpServer };
