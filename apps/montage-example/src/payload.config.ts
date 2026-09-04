import { montagePlugin } from "@abinnovision/payloadcms-montage/config";
import { viewfinderPlugin } from "@abinnovision/payloadcms-viewfinder/config";
import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { lexicalEditor } from "@payloadcms/richtext-lexical";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildConfig } from "payload";

import { heroBlock } from "./blocks/hero";
import { recentPostsBlock } from "./blocks/recent-posts";
import { pages } from "./collections/pages";
import { posts } from "./collections/posts";
import { users } from "./collections/users";

const dirname = path.dirname(fileURLToPath(import.meta.url));

export default buildConfig({
	secret: process.env.PAYLOAD_SECRET ?? "",
	serverURL: process.env.PAYLOAD_URL ?? "http://localhost:3000",
	db: sqliteAdapter({
		client: { url: process.env.DATABASE_URI ?? "file:./.data/montage.db" },
	}),
	editor: lexicalEditor(),
	admin: { user: users.slug },
	collections: [users, pages, posts],
	// The example app's `payload.config.ts` never imports React: `montagePlugin`
	// only appends to `config.blocks`, from the `./config` entrypoint. The
	// section wrapper is deliberately not registered here: it is instantiated
	// inline on `pages.layout` instead (see collections/pages.ts), so it never
	// reaches `config.blocks`.
	plugins: [
		montagePlugin({ blocks: [heroBlock, recentPostsBlock] }),
		/*
		 * Mounts the admin half of viewfinder on the pages collection. Run
		 * `yarn generate:importmap` after adding it, as for any plugin that
		 * contributes admin components.
		 */
		viewfinderPlugin({ collections: ["pages"] }),
	],
	graphQL: { disable: true },
	typescript: { outputFile: path.resolve(dirname, "payload-types.ts") },
});
