import { hasDraftValidationEnabled } from "payload/shared";

import { translateLabel } from "./shared.js";
import { jsonResult } from "../endpoint/result.js";
import { staticDescription } from "../schema/walk.js";

import type { BuiltinTool } from "./types.js";

const DESCRIPTION = `Lists what this key may do: the collections and globals it can read or write, their draft behaviour and id type, the configured locales, the limits in force and the custom tools available. Call it first to orient; nothing here changes with the content model.

A global is a singleton: it has no id, is not listed by findDocuments and cannot be created. Address one with the "global" argument where a collection document would take "collection" and "id".`;

const listCapabilities: BuiltinTool<Record<string, never>> = {
	name: "listCapabilities",
	description: DESCRIPTION,
	annotations: { readOnlyHint: true, openWorldHint: false },
	isEnabled: () => true,
	inputSchema: () => ({}),
	handler: (_args, scope) => {
		const { payload } = scope.req;

		const collections = scope.options.collections.flatMap((entry) => {
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
			const description = staticDescription(config.admin.description);

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
					drafts: entry.hasDrafts,
					draftValidation: hasDraftValidationEnabled(config),
					idType: collection.customIDType ?? payload.db.defaultIDType,
				},
			];
		});

		const globals = scope.options.globals.flatMap((entry) => {
			const capability = scope.capabilities.globals[entry.slug];
			// `payload.globals` is an array of configs, not a slug-keyed map.
			const config = payload.globals.config.find(
				(candidate) => candidate.slug === entry.slug,
			);

			if (!capability || !config || !(capability.read || capability.write)) {
				return [];
			}

			const description = staticDescription(config.admin.description);

			return [
				{
					slug: entry.slug,
					// A global carries one label, not a singular/plural pair.
					label: translateLabel(scope, config.label, entry.slug),
					...(description === undefined ? {} : { description }),
					read: capability.read,
					write: capability.write,
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
				limits: scope.options.limits,
				tools: Object.entries(scope.capabilities.tools)
					.filter(([, enabled]) => enabled)
					.map(([name]) => name),
			}),
		);
	},
};

export { listCapabilities };
