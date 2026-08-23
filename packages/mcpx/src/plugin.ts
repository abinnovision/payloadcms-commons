import { definePlugin } from "payload";

import { createApiKeysCollection } from "./api-keys/collection.js";
import { jsonRpcError } from "./endpoint/result.js";
import { normalizeOptions } from "./options.js";
import { installDraftGuards } from "./write/draft-guard.js";

import type { McpxPluginOptions } from "./types.js";
import type { PayloadHandler } from "payload";

const notImplemented: PayloadHandler = () =>
	jsonRpcError({
		status: 501,
		code: -32000,
		message: "The MCP endpoint is not implemented yet.",
	});

/**
 * Mounts the MCP endpoint, adds the API key collection and installs the
 * draft guard on every collection.
 */
const mcpxPlugin = definePlugin<McpxPluginOptions>({
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
			endpoints: [
				...(config.endpoints ?? []),
				{
					path: normalized.endpointPath,
					method: "post",
					handler: notImplemented,
				},
				{
					path: normalized.endpointPath,
					method: "get",
					handler: notImplemented,
				},
				{
					path: normalized.endpointPath,
					method: "delete",
					handler: notImplemented,
				},
			],
		};
	},
});

export { mcpxPlugin };
