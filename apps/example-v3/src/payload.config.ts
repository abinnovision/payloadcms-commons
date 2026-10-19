import { colophonPlugin } from "@abinnovision/payloadcms-colophon/config";
import { hatchetPlugin } from "@abinnovision/payloadcms-hatchet";
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
import { media } from "./collections/media";
import { pages } from "./collections/pages";
import { posts } from "./collections/posts";
import { sections } from "./collections/sections";
import { tags } from "./collections/tags";
import { users } from "./collections/users";
import { siteSettings } from "./globals/site-settings";
import {
	announceArticleTask,
	articlePublishedWorkflow,
	resolveArticleURLTask,
} from "./jobs/article-published";
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
		/*
		 * Real transactions, which SQLite leaves off by default. A job queued
		 * by a write that rolls back is then never handed to Hatchet.
		 */
		transactionOptions: {},
	}),
	editor: lexicalEditor(),
	admin: { user: users.slug },
	localization: { locales: ["en", "de"], defaultLocale: "en" },
	collections: [users, pages, articles, sections, posts, tags, media],
	globals: [siteSettings],
	jobs: {
		tasks: [resolveArticleURLTask, announceArticleTask],
		workflows: [articlePublishedWorkflow],
		/*
		 * Payload's own runner, used when Hatchet is not configured. The
		 * enabled hatchet plugin removes it, since Hatchet is then the only
		 * trigger.
		 */
		autoRun: [{ cron: "* * * * *", queue: "default" }],
		/*
		 * Finished jobs are kept, and the jobs collection, hidden and unreadable
		 * by default, is shown to signed-in users, so each run can be inspected
		 * in the admin. Demo only, not for production: users have no roles here,
		 * so every user can read every job's input and output.
		 */
		deleteJobOnComplete: false,
		jobsCollectionOverrides: ({ defaultJobsCollection }) => ({
			...defaultJobsCollection,
			admin: { ...defaultJobsCollection.admin, hidden: false },
			access: {
				...defaultJobsCollection.access,
				read: ({ req }) => Boolean(req.user),
			},
		}),
	},
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
		 * Everything is allowed, so every capability can be tried from a key,
		 * including `deleteDocument`: it moves to the trash once approved on
		 * the key's edit view, or at once where the key ticks "Delete without
		 * approval".
		 */

		mcpxPlugin({
			collections: {
				pages: { delete: "unattended" },
				articles: { delete: "unattended" },
				posts: { delete: "unattended" },
				sections: { delete: "unattended" },
				tags: { delete: "unattended" },
				media: { delete: "unattended" },
			},
			globals: {
				"site-settings": true,
			},
			limits: { maxLimit: 25, maxDepth: 1 },
		}),

		/*
		 * Default rows, so the group only appears once `APP_VERSION` and
		 * friends are exported. Starting `yarn dev` without them is the
		 * "nothing configured, nothing rendered" case.
		 */

		colophonPlugin(),
		/*
		 * Always mounted, so the schema is the same with and without Hatchet.
		 * With a token it is enabled: the jobs are triggered through Hatchet
		 * and executed by `yarn worker`, or by `src/instrumentation.ts` with
		 * `HATCHET_IN_PROCESS_WORKER=true`. Without one, `autoRun` above
		 * executes them.
		 */
		hatchetPlugin({ enabled: Boolean(process.env.HATCHET_CLIENT_TOKEN) }),
	],
	graphQL: { disable: true },
	typescript: { outputFile: path.resolve(dirname, "payload-types.ts") },
});
