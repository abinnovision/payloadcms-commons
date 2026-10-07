import { hasDraftValidationEnabled } from "payload/shared";

import { globalConfig } from "./document.js";
import { slugsFor } from "./shared.js";
import { defineMcpxTool } from "../define-tool.js";
import { translateStatic, translatorFor } from "../i18n.js";
import { jsonResult } from "../result.js";
import { MCPX_ISSUES_URL, MCPX_REPOSITORY_URL } from "../version.js";

import type { McpxToolScope } from "../types.js";
import type { LabelFunction, StaticLabel } from "payload";

const DESCRIPTION = `Lists what this key may do. Call it first. Returns each collection and global the key can read or write, with whether it can create, publish, has drafts and exposes versions to findVersions, and a collection's "idType". Also returns the locales, the "limits" on page size and depth, and the enabled custom tools.`;

const DIAGNOSTICS = ` Its "server" block holds the server version with repository and issue links, for a bug report.`;

const translateLabel = (
	scope: McpxToolScope,
	label: LabelFunction | StaticLabel | undefined,
	fallback: string,
): string => {
	const { i18n, t } = scope.req;
	const resolved = typeof label === "function" ? label({ i18n, t }) : label;

	return translateStatic(resolved, i18n) ?? fallback;
};

/**
 * Registered for every key, even one with no capabilities ticked, so a client
 * always has a tool to call and gets an empty surface described instead of an
 * empty tool list. The response comes from the request scope and the sanitized
 * config, not the content model, so it stays the same size as a deployment
 * grows.
 */
export const listCapabilities = defineMcpxTool({
	name: "listCapabilities",
	description: (scope) =>
		scope.diagnostics ? `${DESCRIPTION}${DIAGNOSTICS}` : DESCRIPTION,
	annotations: { readOnlyHint: true, openWorldHint: false },
	isEnabled: () => true,
	inputSchema: () => ({}),
	handler: ({ scope }) => {
		const { payload } = scope.req;
		const translate = translatorFor(scope.req.i18n);
		const creatable = slugsFor(scope, "create").collections;

		const collections = scope.exposure.collections.flatMap((entry) => {
			const capability = scope.capabilities.collections[entry.slug];
			const collection = payload.collections[entry.slug];

			if (!capability || !collection || !capability.read) {
				return [];
			}

			const { config } = collection;
			const description = translate(config.admin.description);

			return [
				{
					slug: entry.slug,
					labels: {
						singular: translateLabel(scope, config.labels.singular, entry.slug),
						plural: translateLabel(scope, config.labels.plural, entry.slug),
					},
					...(description === undefined ? {} : { description }),
					read: capability.read,
					write: capability.write,
					/*
					 * Stated separately because it is the one narrowing of `write`
					 * a client cannot infer: `createDocument` drops an upload
					 * collection whose files MCP does not accept from its enum, and
					 * where it is the only writable one the tool is not registered
					 * at all, leaving nothing else to read it off.
					 */
					create: creatable.includes(entry.slug),
					publish: capability.publish,
					drafts: entry.hasDrafts,
					versions: entry.hasVersions,
					draftValidation: hasDraftValidationEnabled(config),
					idType: collection.customIDType ?? payload.db.defaultIDType,
				},
			];
		});

		const globals = scope.exposure.globals.flatMap((entry) => {
			const capability = scope.capabilities.globals[entry.slug];
			const config = globalConfig(payload, entry.slug);

			if (!capability || !config || !capability.read) {
				return [];
			}

			const description = translate(config.admin.description);

			return [
				{
					slug: entry.slug,
					// A global carries one label, not a singular/plural pair.
					label: translateLabel(scope, config.label, entry.slug),
					...(description === undefined ? {} : { description }),
					read: capability.read,
					write: capability.write,
					publish: capability.publish,
					drafts: entry.hasDrafts,
					versions: entry.hasVersions,
					draftValidation: hasDraftValidationEnabled(config),
					// No idType: a global is a singleton with no id.
				},
			];
		});

		return jsonResult({
			collections,
			...(globals.length > 0 ? { globals } : {}),
			locales: scope.localization
				? {
						codes: scope.localization.locales,
						default: scope.localization.defaultLocale,
					}
				: null,
			limits: scope.limits,
			tools: Object.entries(scope.capabilities.tools)
				.filter(([, enabled]) => enabled)
				.map(([name]) => name),
			...(scope.diagnostics
				? {
						server: {
							name: scope.diagnostics.name,
							version: scope.diagnostics.version,
							repository: MCPX_REPOSITORY_URL,
							issues: MCPX_ISSUES_URL,
						},
					}
				: {}),
		});
	},
});
