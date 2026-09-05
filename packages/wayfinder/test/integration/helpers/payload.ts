import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { buildConfig, getPayload } from "payload";

import {
	createMappingGlobal,
	wayfinderPlugin,
} from "../../../src/config/index.js";

import type { CollectionConfig, Payload, SanitizedConfig } from "payload";

/** The locale the localized fixture authors its mapping in. */
export const PRIMARY_LOCALE = "en";

/**
 * A second, identically shaped mapping global that no test ever writes to.
 *
 * Stands in for a project's first boot, where the global is registered but has
 * no row behind it yet.
 */
export const UNSAVED_MAPPING_GLOBAL_SLUG = "unsaved-mapping";

export interface FixtureArgs {
	/**
	 * Whether the config declares a `localization` block. The mapping global's
	 * `path` field is localized to match, because Payload returns a scalar for
	 * an unlocalized field and a per-locale record for a localized one, and
	 * the read side has to be told which shape to expect.
	 */
	localized?: boolean;
	/**
	 * Declared on the plugin only. `loadMappings` has to find it on the
	 * global's own config, which is what stops the write side validating
	 * against one field while the read side compiles for another.
	 */
	fallbackIdentifierField?: string;
}

/**
 * `pages` is keyed by a full path rather than a bare segment, which is what
 * makes the wildcard mapping (`/*slug`) meaningful: one collection owns every
 * path no other pattern claims. Drafts are on so preview reads have something
 * to find.
 */
const pages: CollectionConfig = {
	slug: "pages",
	versions: { drafts: true },
	fields: [
		{ name: "title", type: "text", required: true },
		{ name: "slug", type: "text", required: true },
	],
};

/**
 * `handle` exists alongside `slug` so a test can point the mapping at a
 * non-`slug` parameter and observe that the queried field follows the pattern
 * rather than the default.
 */
const sections: CollectionConfig = {
	slug: "sections",
	fields: [
		{ name: "title", type: "text", required: true },
		{ name: "slug", type: "text", required: true },
		{ name: "handle", type: "text", required: true },
	],
};

const articles: CollectionConfig = {
	slug: "articles",
	fields: [
		{ name: "title", type: "text", required: true },
		{ name: "slug", type: "text", required: true },
		{ name: "section", type: "relationship", relationTo: "sections" },
	],
};

/** Deliberately without `versions`, to exercise the `_status` guard. */
const notes: CollectionConfig = {
	slug: "notes",
	fields: [
		{ name: "title", type: "text", required: true },
		{ name: "slug", type: "text", required: true },
	],
};

/**
 * Builds a Payload config around `wayfinderPlugin`, with or without
 * localization.
 *
 * @param args Whether the config declares locales.
 */
export const buildFixtureConfig = (
	args: FixtureArgs = {},
): Promise<SanitizedConfig> => {
	const localized = args.localized ?? true;

	return buildConfig({
		secret: "wayfinder-integration-test",
		db: sqliteAdapter({ client: { url: ":memory:" } }),
		collections: [pages, sections, articles, notes],
		globals: [
			createMappingGlobal({
				globalSlug: UNSAVED_MAPPING_GLOBAL_SLUG,
				localized,
			}),
		],
		...(localized
			? {
					localization: {
						locales: [PRIMARY_LOCALE, "de"],
						defaultLocale: PRIMARY_LOCALE,
					},
				}
			: {}),
		plugins: [
			wayfinderPlugin({
				localized,
				quiet: true,
				...(args.fallbackIdentifierField
					? { fallbackIdentifierField: args.fallbackIdentifierField }
					: {}),
			}),
		],
		typescript: { autoGenerate: false },
		graphQL: { disable: true },
	});
};

export interface BootArgs extends FixtureArgs {
	/**
	 * `getPayload` caches per key, and each fixture uses its own in-memory
	 * sqlite database, so a distinct key yields a genuinely separate instance.
	 */
	key: string;
}

export const bootPayload = async (args: BootArgs): Promise<Payload> => {
	const config = buildFixtureConfig(args);

	return await getPayload({ config, key: args.key });
};
