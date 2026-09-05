import { mcpxPlugin } from "@abinnovision/payloadcms-mcpx";
import { montagePlugin } from "@abinnovision/payloadcms-montage/config";
import { viewfinderPlugin } from "@abinnovision/payloadcms-viewfinder/config";
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
import { pages } from "./collections/pages";
import { posts } from "./collections/posts";
import { sections } from "./collections/sections";
import { tags } from "./collections/tags";
import { users } from "./collections/users";
import { siteSettings } from "./globals/site-settings";
import { linkTargets } from "./links";

const dirname = path.dirname(fileURLToPath(import.meta.url));

const databaseURI = process.env.DATABASE_URI ?? "file:./.data/example.db";

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
	// Required. Both JWT signing and the mcpx API key index derive from it.
	secret: process.env.PAYLOAD_SECRET ?? "",
	// Its origin is the `adminOrigin` the viewfinder bridge trusts, and it is
	// what the mcpx setup guide prints as an absolute endpoint URL.
	serverURL: process.env.PAYLOAD_URL ?? "http://localhost:3000",
	db: sqliteAdapter({
		client: { url: databaseURI },
	}),
	editor: lexicalEditor(),
	admin: { user: users.slug },
	localization: { locales: ["en", "de"], defaultLocale: "en" },
	collections: [users, pages, articles, sections, posts, tags],
	globals: [siteSettings],
	/*
	 * This file never imports React. Every plugin here comes from an
	 * entrypoint that is free of it, which is what lets the config be loaded
	 * by `payload run`, `generate:types` and the admin bundle alike.
	 */
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
		 * Mounts the admin half of viewfinder on the two routed collections.
		 * Run `yarn generate:importmap` after adding it, as for any plugin that
		 * contributes admin components.
		 */
		viewfinderPlugin({ collections: ["pages", "articles"] }),
		/*
		 * `localized: true` because this app has a `localization` block, so the
		 * mapping global holds one pattern per locale. The same flag has to be
		 * passed to every read; `src/wayfinder.ts` keeps the two in step.
		 */
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
		 * `pages` is the entity to reach for when trying out `publishDocument`.
		 * `articles` and `posts` show the other side of the axis, where MCP
		 * writes stay drafts and a human publishes.
		 */
		mcpxPlugin({
			collections: {
				pages: { read: true, write: "live" },
				articles: { read: true, write: "draft" },
				posts: { read: true, write: "draft" },
				sections: { read: true, write: "live" },
				tags: true,
			},
			globals: { "site-settings": { read: true, write: "live" } },
			limits: { maxLimit: 25, maxDepth: 1 },
		}),
	],
	graphQL: { disable: true },
	typescript: { outputFile: path.resolve(dirname, "payload-types.ts") },
});
