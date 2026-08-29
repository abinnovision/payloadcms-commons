import { hasDraftValidationEnabled } from "payload/shared";

import { translateLabel } from "./shared.js";
import { canCreate } from "../capabilities.js";
import { translatorFor } from "../i18n.js";
import { jsonResult } from "../result.js";
import { defineMcpxTool } from "../types.js";

const DESCRIPTION = `Lists what this key may do: the collections and globals it can read or write, whether a collection can also be created in, their draft behaviour and id type, the configured locales, the limits in force and the custom tools available. Call it first to orient; nothing here changes with the content model.

A global is a singleton: it has no id, is not listed by findDocuments and cannot be created. Address one with the "global" argument where a collection document would take "collection" and "id".`;

/**
 * Registered for every key, including one with no capabilities ticked, so a
 * client always has something to call and gets an empty surface described
 * rather than an empty tool list. The response is assembled from the request
 * scope and the sanitized config, never from the content model, so it stays the
 * same size as a deployment grows.
 */
export const listCapabilities = defineMcpxTool({
	name: "listCapabilities",
	description: DESCRIPTION,
	annotations: { readOnlyHint: true, openWorldHint: false },
	isEnabled: () => true,
	inputSchema: () => ({}),
	handler: ({ scope }) => {
		const { payload } = scope.req;
		const translate = translatorFor(scope.req.i18n);

		const collections = scope.exposure.collections.flatMap((entry) => {
			const capability = scope.capabilities.collections[entry.slug];
			const collection = payload.collections[entry.slug];

			if (
				!capability ||
				!collection ||
				!(capability.read || capability.write)
			) {
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
					 * a client cannot infer: `createDocument` drops the collection
					 * from its enum, and where it is the only writable one the tool
					 * is not registered at all, leaving nothing else to read it off.
					 */
					create: capability.write && canCreate(entry),
					publish: capability.publish,
					drafts: entry.hasDrafts,
					draftValidation: hasDraftValidationEnabled(config),
					idType: collection.customIDType ?? payload.db.defaultIDType,
				},
			];
		});

		const globals = scope.exposure.globals.flatMap((entry) => {
			const capability = scope.capabilities.globals[entry.slug];
			// `payload.globals` is an array of configs, not a slug-keyed map.
			const config = payload.globals.config.find(
				(candidate) => candidate.slug === entry.slug,
			);

			if (!capability || !config || !(capability.read || capability.write)) {
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
					draftValidation: hasDraftValidationEnabled(config),
					// No idType: a global is a singleton with no id.
				},
			];
		});

		return Promise.resolve(
			jsonResult({
				collections,
				...(globals.length > 0 ? { globals } : {}),
				locales: scope.locales
					? { codes: scope.locales, default: scope.defaultLocale }
					: null,
				limits: scope.limits,
				tools: Object.entries(scope.capabilities.tools)
					.filter(([, enabled]) => enabled)
					.map(([name]) => name),
			}),
		);
	},
});
