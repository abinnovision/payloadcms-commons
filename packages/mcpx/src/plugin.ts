import { definePlugin } from "payload";

import { createApiKeysCollection } from "./api-keys/index.js";
import { createMcpxHandler, methodNotAllowed } from "./endpoint/index.js";
import { normalizeOptions } from "./options.js";
import { installDraftGuards, installGlobalDraftGuards } from "./write/index.js";

import type { McpxPluginOptions } from "./types.js";

/**
 * Mounts the MCP endpoint, adds the API key collection and installs the
 * draft guard on every collection and global.
 */
export const mcpxPlugin = definePlugin<McpxPluginOptions>({
	slug: "@abinnovision/payloadcms-mcpx",
	order: 100,
	plugin: ({ config, plugins: _plugins, ...options }) => {
		const normalized = normalizeOptions(config, options);

		const apiKeys = createApiKeysCollection(normalized);
		const apiKeysCollection =
			options.apiKeys?.overrideCollection?.(apiKeys) ?? apiKeys;

		return {
			...config,
			collections: installDraftGuards([
				...(config.collections ?? []),
				apiKeysCollection,
			]),
			globals: installGlobalDraftGuards(config.globals ?? []),
			endpoints: [
				...(config.endpoints ?? []),
				{
					path: normalized.endpointPath,
					method: "post",
					handler: createMcpxHandler(normalized),
				},
				{
					path: normalized.endpointPath,
					method: "get",
					handler: methodNotAllowed,
				},
				{
					path: normalized.endpointPath,
					method: "delete",
					handler: methodNotAllowed,
				},
			],
		};
	},
});
