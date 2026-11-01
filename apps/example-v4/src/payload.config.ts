import { colophonPlugin } from "@abinnovision/payloadcms-colophon/config";
import { montagePlugin } from "@abinnovision/payloadcms-montage/config";
import { wayfinderPlugin } from "@abinnovision/payloadcms-wayfinder/config";
import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { lexicalEditor } from "@payloadcms/richtext-lexical";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildConfig } from "payload";

import { callToActionBlock } from "./blocks/call-to-action";
import { calloutBlock } from "./blocks/callout";
import { heroBlock } from "./blocks/hero";
import { recentPostsBlock } from "./blocks/recent-posts";
import { richTextBlock } from "./blocks/rich-text";
import { articles } from "./collections/articles";
import { media } from "./collections/media";
import { pages } from "./collections/pages";
import { posts } from "./collections/posts";
import { sections } from "./collections/sections";
import { tags } from "./collections/tags";
import { users } from "./collections/users";
import { siteSettings } from "./globals/site-settings";
import { linkTargets } from "./links";

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
	collections: [users, pages, articles, sections, posts, tags, media],
	globals: [siteSettings],
	plugins: [
		/*
		 * Only appends to `config.blocks`. The section wrapper is deliberately
		 * absent: it is instantiated per host on `pages.layout` and
		 * `articles.layout` instead, so it never reaches `config.blocks`.
		 */
		montagePlugin({
			blocks: [
				heroBlock,
				richTextBlock,
				recentPostsBlock,
				callToActionBlock,
				calloutBlock,
			],
		}),
		/*
		 * No `localized`: it is derived from the `localization` block above,
		 * which is the same fact the read side derives it from, so the two
		 * cannot fall out of step.
		 *
		 * The checked list is the one the link fields already offer, so a
		 * collection cannot become linkable without also being checked for the
		 * `defaultPopulate` that makes its links resolve.
		 */
		wayfinderPlugin({ checkDefaultPopulateOn: linkTargets.relationTo }),
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
