import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { buildConfig } from "payload";

import { tagsPlugin } from "../../src/config/index.js";

import type { CollectionConfig, SanitizedConfig } from "payload";

/** Drafts, so a tag deletion has to reach the versions table too. */
const posts: CollectionConfig = {
	slug: "posts",
	versions: { drafts: true },
	fields: [{ name: "title", type: "text", required: true }],
};

const pages: CollectionConfig = {
	slug: "pages",
	fields: [{ name: "title", type: "text", required: true }],
};

const users: CollectionConfig = { slug: "users", auth: true, fields: [] };

/** The plugin generates `tags` and adds the field to `posts` and `pages`. */
export const buildFixtureConfig = (): Promise<SanitizedConfig> =>
	buildConfig({
		secret: "tags-integration-test",
		db: sqliteAdapter({ client: { url: ":memory:" } }),
		collections: [users, posts, pages],
		plugins: [tagsPlugin({ collections: ["posts", "pages"] })],
		typescript: { autoGenerate: false },
		graphQL: { disable: true },
	});
