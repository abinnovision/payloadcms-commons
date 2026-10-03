import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { toToolError } from "./errors.js";
import { BUILTIN_TOOLS } from "../tools/builtin.js";
import { liveWriteSlugs } from "../tools/shared.js";
import { MCPX_REPOSITORY_URL } from "../version.js";

import type { NormalizedOptions } from "../options.js";
import type { McpxAnyTool, McpxToolScope } from "../types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/**
 * Strict, so an unknown argument is rejected by name instead of stripped.
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

// May be built from the scope, to name the entities this key writes live.
const toolDescription = (tool: McpxAnyTool, scope: McpxToolScope): string =>
	typeof tool.description === "function"
		? tool.description(scope)
		: tool.description;

/**
 * A tool that does not decide for itself is gated by its own checkbox.
 */
export const isToolEnabled = (
	tool: McpxAnyTool,
	scope: McpxToolScope,
): boolean =>
	tool.isEnabled
		? tool.isEnabled(scope)
		: scope.capabilities.tools[tool.name] === true;

/* The call order across tools. A step keeps only the tools this key has. */
const WORKFLOW: { tools: string[]; does: string }[] = [
	{ tools: ["listCapabilities"], does: "what this key may access" },
	{ tools: ["describeSchema"], does: "the fields" },
	{
		tools: ["findDocuments", "getDocument"],
		does: 'the content and its "updatedAt"',
	},
	{ tools: ["patchDocument", "createDocument"], does: "the write" },
	{ tools: ["validateDocument"], does: "what blocks publishing" },
	{ tools: ["publishDocument"], does: "make the draft public" },
];

const PATHS = `describeSchema takes and returns schema paths. Every other "path", and "from" in a patch operation, is a pointer into a document, with a 0-based index where a schema path has "*" for an array element or a block slug: "/layout/sections/sectionWrapper/identifier" is "/layout/sections/0/identifier". In rich text a pointer enters the rich text state: "/content/block/callout/tone" is "/content/root/children/3/fields/tone". getDocument "outline" gives the index.`;

const DRAFTS =
	"Writes are saved as drafts, except in collections and globals without drafts, which patchDocument names: those go live immediately.";

const DRAFTS_ONLY = "Every write is saved as a draft.";

/**
 * The workflow for the tools this key has, and what its writes reach.
 */
const serverInstructions = (scope: McpxToolScope): string => {
	const enabled = new Set(
		BUILTIN_TOOLS.filter((tool) => isToolEnabled(tool, scope)).map(
			(tool) => tool.name,
		),
	);
	const steps = WORKFLOW.flatMap(({ tools, does }) => {
		const present = tools.filter((name) => enabled.has(name));

		return present.length === 0 ? [] : [`${present.join(" or ")}: ${does}.`];
	}).map((step, index) => `${String(index + 1)}. ${step}`);
	const publishing = enabled.has("publishDocument")
		? ""
		: " This key cannot publish. A person publishes drafts in the admin panel.";
	const drafts =
		liveWriteSlugs(scope, "write").length === 0 ? DRAFTS_ONLY : DRAFTS;
	const writes = enabled.has("patchDocument")
		? `\n\n${drafts}${publishing}`
		: "";
	// Schema paths exist only where describeSchema does.
	const paths = enabled.has("describeSchema") ? `\n\n${PATHS}` : "";

	return `Call the tools in this order:\n${steps.join("\n")}${paths}${writes}`;
};

/**
 * One server per request. Builtin and configured tools take the same route,
 * each registered against the key's capabilities, so `tools/list` shows exactly
 * what the key may call. The tool handlers of one JSON-RPC batch run one at a time,
 * so a failed call cannot roll back a write another call reported as done.
 */
export const createMcpServer = (
	scope: McpxToolScope,
	options: NormalizedOptions,
): McpServer => {
	const { req } = scope;
	const { logger } = req.payload;
	let queue: Promise<unknown> = Promise.resolve();

	const server = new McpServer(
		{
			name: options.serverInfo.name,
			version: options.serverInfo.version,
			...(options.diagnostics ? { websiteUrl: MCPX_REPOSITORY_URL } : {}),
		},
		{
			instructions: serverInstructions(scope),
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
			(args, extra): Promise<CallToolResult> => {
				const result = queue.then(async (): Promise<CallToolResult> => {
					try {
						return await tool.handler({
							args: args as never,
							scope,
							req,
							extra,
						});
					} catch (error) {
						return toToolError(error, logger);
					}
				});

				queue = result.catch(() => undefined);

				return result;
			},
		);
	}

	return server;
};
