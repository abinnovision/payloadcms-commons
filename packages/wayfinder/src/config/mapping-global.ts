import { pathToRegexp } from "path-to-regexp";
import { text } from "payload/shared";

import { createCollectionStringField } from "./collection-string-field.js";
import { hasDuplicates } from "./has-duplicates.js";
import { translate } from "./translations.js";
import { resolveParamQueryPath } from "../pattern/param-query-path.js";

import type { CollectionSlug, GlobalConfig, TextField } from "payload";

/** The global the mapping is authored in, unless overridden. */
export const DEFAULT_MAPPING_GLOBAL_SLUG = "collections-mapping";

export interface CreateMappingGlobalArgs {
	/** Defaults to {@link DEFAULT_MAPPING_GLOBAL_SLUG}. */
	globalSlug?: string;
	/**
	 * Whether path patterns differ per locale.
	 *
	 * Derived from the config's `localization` block by `wayfinderPlugin`, and
	 * from the running instance by `loadMappings`, so a project normally never
	 * sets it. Pass it only to override that — and then to both sides, because
	 * Payload returns a scalar for an unlocalized field and a per-locale record
	 * for a localized one, and the read has to expect the shape the write
	 * produced.
	 */
	localized?: boolean;
	/**
	 * The field a relationship parameter falls back to when the target
	 * collection's pattern cannot name one. Used here to validate a pattern at
	 * save time, before any mapping has been compiled to carry it.
	 */
	fallbackIdentifierField?: string;
	label?: GlobalConfig["label"];
	adminGroup?: string;
	access?: GlobalConfig["access"];
	/** Generated-type name for the array rows. Unset by default. */
	interfaceName?: string;
	/** Called after the mapping changes, for cache invalidation. */
	onChange?: () => void | Promise<void>;
}

/**
 * Builds the global that maps collections onto the URL patterns they serve.
 *
 * Routing lives in content rather than in code, so adding a page type is an
 * editorial act. Everything else in the package reads what this produces.
 *
 * @param args Slug, localization and presentation overrides.
 */
export const createMappingGlobal = (
	args: CreateMappingGlobalArgs = {},
): GlobalConfig => {
	const localized = args.localized ?? true;

	const pathField: TextField = {
		type: "text",
		name: "path",
		required: true,
		localized,
		admin: {
			description:
				'Path pattern, e.g. "/:section/:slug". Use "/*slug" for a collection whose identifier is a full path.',
		},
		validate: (value, opts) => {
			const base = text(value, opts);

			if (base !== true) {
				return base;
			}

			const t = opts.req.t as never;

			if (typeof value !== "string") {
				return translate(t, "invalidPath");
			}

			let parsed;

			try {
				parsed = pathToRegexp(value);
			} catch {
				return translate(t, "pathUnparseable");
			}

			if (parsed.keys.length === 0) {
				return translate(t, "pathNeedsParameter");
			}

			const collectionName = (
				opts.siblingData as { collectionName?: CollectionSlug }
			).collectionName;

			if (!collectionName) {
				return translate(t, "selectCollectionFirst");
			}

			const collection = opts.req.payload.collections[collectionName];

			if (!collection) {
				return translate(t, "selectCollectionFirst");
			}

			/*
			 * Every parameter has to resolve to something queryable, otherwise
			 * the catch-all would match the URL and then fail to find the
			 * document behind it.
			 */
			for (const key of parsed.keys) {
				const resolved = resolveParamQueryPath({
					config: collection.config,
					param: key.name,
					collections: opts.req.payload.collections,
					...(args.fallbackIdentifierField
						? { fallbackIdentifierField: args.fallbackIdentifierField }
						: {}),
				});

				if ("error" in resolved) {
					return resolved.error;
				}
			}

			return true;
		},
	};

	return {
		slug: args.globalSlug ?? DEFAULT_MAPPING_GLOBAL_SLUG,
		label: args.label ?? "Collections Mapping",
		...(args.access ? { access: args.access } : {}),
		admin: {
			group: args.adminGroup ?? "Settings",
			description:
				"Maps each collection onto the URL pattern its documents are served at. The last parameter identifies the document; earlier parameters narrow the lookup.",
		},
		...(args.onChange
			? { hooks: { afterChange: [() => void args.onChange!()] } }
			: {}),
		fields: [
			{
				type: "array",
				name: "collections",
				minRows: 0,
				required: true,
				...(args.interfaceName ? { interfaceName: args.interfaceName } : {}),
				validate: (value, opts) => {
					const rows = Array.isArray(value) ? value : [];
					const t = opts.req.t as never;

					if (
						hasDuplicates(
							rows.map(
								(it) => (it as { collectionName?: string }).collectionName,
							),
						)
					) {
						return translate(t, "duplicateCollection");
					}

					/*
					 * Two collections on the same pattern tie on every
					 * specificity measure, which would leave the winner up to
					 * row order for path lookups and up to nothing at all for
					 * href building.
					 */
					const paths = rows.flatMap((it) => {
						const path = (it as { path?: unknown }).path;

						if (typeof path === "string") {
							return [path];
						}

						return path && typeof path === "object"
							? Object.entries(path).map(
									([locale, pattern]) => `${locale}:${String(pattern)}`,
								)
							: [];
					});

					if (hasDuplicates(paths)) {
						return translate(t, "duplicatePath");
					}

					return true;
				},
				fields: [
					createCollectionStringField({
						name: "collectionName",
						required: true,
					}),
					pathField,
				],
			},
		],
	};
};
