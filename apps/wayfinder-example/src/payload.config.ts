import { wayfinderPlugin } from "@abinnovision/payloadcms-wayfinder/config";
import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { lexicalEditor } from "@payloadcms/richtext-lexical";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildConfig } from "payload";

import { articles } from "./collections/articles";
import { pages } from "./collections/pages";
import { sections } from "./collections/sections";
import { users } from "./collections/users";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default buildConfig({
	secret: process.env.PAYLOAD_SECRET ?? "",
	serverURL: process.env.PAYLOAD_URL ?? "http://localhost:3000",
	db: sqliteAdapter({
		client: { url: process.env.DATABASE_URI ?? "file:./.data/wayfinder.db" },
	}),
	editor: lexicalEditor(),
	admin: { user: users.slug },
	collections: [users, pages, sections, articles],
	/*
	 * No `localization` block, on purpose: this app exercises the unlocalized
	 * path, so the mapping global holds one pattern per collection rather than
	 * one per locale. `localized: false` has to be passed to `loadMappings`
	 * too, which is why the plugin and the reader share one options object in
	 * a real app.
	 */
	plugins: [
		wayfinderPlugin({
			localized: false,
			linkableCollections: ["pages", "articles", "sections"],
		}),
	],
	graphQL: { disable: true },
	typescript: { outputFile: path.resolve(dirname, "payload-types.ts") },
});
