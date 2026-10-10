import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { lexicalEditor } from "@payloadcms/richtext-lexical";
import { buildConfig } from "payload";

import {
	ambiguous,
	authors,
	books,
	keyless,
	media,
	pages,
	posts,
	snippets,
	tags,
	users,
} from "./collections.js";
import { banner, menus, routes, siteSettings } from "./globals.js";

import type {
	CollectionConfig,
	DatabaseAdapterObj,
	SanitizedConfig,
} from "payload";

/**
 * The config every spec seeds against.
 *
 * `sqliteAdapter` only connects in `init`, so this is safe for a unit spec that
 * never calls `getPayload`.
 *
 * @param overrides Extra collections, or a different adapter.
 */
export const buildFixtureConfig = (
	overrides: {
		collections?: CollectionConfig[];
		db?: DatabaseAdapterObj;
	} = {},
): Promise<SanitizedConfig> =>
	buildConfig({
		secret: "payloadcms-dummy-test-secret",
		db: overrides.db ?? sqliteAdapter({ client: { url: ":memory:" } }),
		editor: lexicalEditor(),
		localization: { locales: ["en", "de"], defaultLocale: "en" },
		collections: [
			users,
			pages,
			posts,
			tags,
			snippets,
			media,
			authors,
			books,
			ambiguous,
			keyless,
			...(overrides.collections ?? []),
		],
		globals: [siteSettings, banner, routes, menus],
		typescript: { autoGenerate: false },
		graphQL: { disable: true },
	});
