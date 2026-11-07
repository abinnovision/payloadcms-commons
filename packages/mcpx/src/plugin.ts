import { definePlugin } from "payload";

import { createApiKeysCollection } from "./api-keys/collection.js";
import { confirmationEndpoints } from "./endpoint/confirmations.js";
import { createMcpxHandler, methodNotAllowed } from "./endpoint/handler.js";
import {
	createDownloadHandler,
	createUploadHandler,
} from "./endpoint/upload.js";
import { normalizeOptions, reconcileOptions } from "./options.js";
import { BUILTIN_TOOLS } from "./tools/builtin.js";
import {
	installDraftGuards,
	installGlobalDraftGuards,
} from "./write/draft-guard.js";

import type { NormalizedOptions } from "./options.js";
import type { McpxPluginOptions } from "./types.js";
import type { Payload, SanitizedConfig } from "payload";

// Filled in `onInit`: the sanitized config is a different object than the one the plugin sees.
const initialized = new WeakMap<SanitizedConfig, NormalizedOptions>();

/**
 * The normalized options of the plugin installed on `payload`. Throws where
 * the plugin is not installed or Payload has not run `onInit`.
 */
export const optionsOf = (payload: Payload): NormalizedOptions => {
	const options = initialized.get(payload.config);

	if (options === undefined) {
		throw new Error(
			"[payloadcms-mcpx] The plugin is not installed on this Payload instance, or Payload has not been initialized.",
		);
	}

	return options;
};

// Payload 4 passes `{ options }`, Payload 3 spreads the options into the arguments.
const pluginOptions = (args: object): McpxPluginOptions => {
	if ("options" in args) {
		return args.options as McpxPluginOptions;
	}

	const {
		config: _config,
		plugins: _plugins,
		...rest
	} = args as Record<string, unknown>;

	return rest as McpxPluginOptions;
};

/**
 * Mounts the MCP, upload and download endpoints, and the confirmation
 * endpoints where a collection exposes `delete`. Adds the API key collection
 * and installs the draft guard on every collection and global. Checks the
 * options against the sanitized config once Payload has built it.
 */
export const mcpxPlugin = definePlugin<McpxPluginOptions>({
	slug: "@abinnovision/payloadcms-mcpx",
	order: 100,
	plugin: (args) => {
		const { config } = args;
		const options = pluginOptions(args);
		const normalized = normalizeOptions(
			config,
			options,
			BUILTIN_TOOLS.map((tool) => tool.name),
		);

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
			onInit: async (payload) => {
				reconcileOptions(config, payload.config, normalized);
				initialized.set(payload.config, normalized);
				await config.onInit?.(payload);
			},
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
				{
					path: `${normalized.endpointPath}/upload`,
					method: "put",
					handler: createUploadHandler(normalized),
				},
				{
					path: `${normalized.endpointPath}/file`,
					method: "get",
					handler: createDownloadHandler(normalized),
				},
				...(normalized.confirmations ? confirmationEndpoints(normalized) : []),
			],
		};
	},
});
