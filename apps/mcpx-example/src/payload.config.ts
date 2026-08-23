import { mcpxPlugin } from "@abinnovision/payloadcms-mcpx";
import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { lexicalEditor } from "@payloadcms/richtext-lexical";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildConfig } from "payload";

import { richTextBlock } from "./blocks/rich-text";
import { pages } from "./collections/pages";
import { posts } from "./collections/posts";
import { tags } from "./collections/tags";
import { users } from "./collections/users";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default buildConfig({
	// Required. Both JWT signing and the API key index derive from it.
	secret: process.env.PAYLOAD_SECRET ?? "",
	db: sqliteAdapter({
		client: { url: process.env.DATABASE_URI ?? "file:./.data/mcpx.db" },
	}),
	editor: lexicalEditor(),
	admin: { user: users.slug },
	localization: { locales: ["en", "de"], defaultLocale: "en" },
	blocks: [richTextBlock],
	collections: [users, pages, posts, tags],
	plugins: [
		mcpxPlugin({
			collections: {
				pages: { read: true, write: true },
				posts: { read: true, write: true },
				tags: true,
			},
			limits: { maxLimit: 25, maxDepth: 1 },
		}),
	],
	graphQL: { disable: true },
	typescript: { outputFile: path.resolve(dirname, "payload-types.ts") },
});
