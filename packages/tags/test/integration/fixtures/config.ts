import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { buildConfig } from "payload";

import { tagsPlugin } from "../../../src/config/index.js";

import type { CollectionConfig, SanitizedConfig } from "payload";

/**
 * Adopted, not generated: a project's own `tags` collection with its own
 * access rule and its own hook, which the plugin must leave standing
 * alongside the two it prepends.
 *
 * `create` is gated on a signed-in user so a test can prove the plugin
 * neither loosens nor bypasses it. The `flagged` field and its hook are the
 * probe for "the project's own hook still runs": every write sets it, so its
 * absence would mean the plugin replaced the hook list instead of prepending
 * to it.
 */
const tags: CollectionConfig = {
	slug: "tags",
	admin: { useAsTitle: "title" },
	access: {
		read: () => true,
		create: ({ req }) => Boolean(req.user),
	},
	fields: [
		{ name: "title", type: "text", required: true },
		{ name: "flagged", type: "checkbox", defaultValue: false },
	],
	hooks: {
		beforeChange: [({ data }) => ({ ...data, flagged: true })],
	},
};

/** Drafts, and an existing `tags` field the plugin must upgrade in place. */
const posts: CollectionConfig = {
	slug: "posts",
	versions: { drafts: true },
	fields: [
		{ name: "title", type: "text", required: true },
		{ name: "tags", type: "relationship", relationTo: "tags", hasMany: true },
	],
};

/** No `tags` field at all: the plugin must append one. */
const pages: CollectionConfig = {
	slug: "pages",
	fields: [{ name: "title", type: "text", required: true }],
};

const users: CollectionConfig = { slug: "users", auth: true, fields: [] };

export const buildFixtureConfig = (): Promise<SanitizedConfig> =>
	buildConfig({
		secret: "tags-integration-test",
		db: sqliteAdapter({ client: { url: ":memory:" } }),
		collections: [users, tags, posts, pages],
		plugins: [tagsPlugin({ collections: ["posts", "pages"] })],
		typescript: { autoGenerate: false },
		graphQL: { disable: true },
	});
