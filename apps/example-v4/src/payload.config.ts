import { colophonPlugin } from "@abinnovision/payloadcms-colophon/config";
import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { lexicalEditor } from "@payloadcms/richtext-lexical";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildConfig } from "payload";

import { media } from "./collections/media";
import { pages } from "./collections/pages";
import { posts } from "./collections/posts";
import { tags } from "./collections/tags";
import { users } from "./collections/users";
import { siteSettings } from "./globals/site-settings";

const dirname = path.dirname(fileURLToPath(import.meta.url));

const databaseURI = process.env.DATABASE_URI ?? "file:./.data/example-v4.db";

/*
 * libsql opens a file but does not create the directory holding it, and the
 * default lives in one that is gitignored. Without this a fresh clone fails to
 * connect before it ever reaches the admin panel.
 */
if (databaseURI.startsWith("file:")) {
	mkdirSync(path.dirname(databaseURI.slice("file:".length)), {
		recursive: true,
	});
}

export default buildConfig({
	secret: process.env.PAYLOAD_SECRET ?? "",
	serverURL: process.env.PAYLOAD_URL ?? "http://localhost:3001",
	db: sqliteAdapter({ client: { url: databaseURI } }),
	editor: lexicalEditor(),
	admin: { user: users.slug },
	localization: { locales: ["en", "de"], defaultLocale: "en" },
	collections: [users, pages, posts, tags, media],
	globals: [siteSettings],
	plugins: [
		/*
		 * Default rows, so the group only appears once `APP_VERSION` and
		 * friends are exported. Starting `yarn dev` without them is the
		 * "nothing configured, nothing rendered" case.
		 */
		colophonPlugin(),
	],
	graphQL: { disable: true },
	typescript: { outputFile: path.resolve(dirname, "payload-types.ts") },
});
