import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { buildConfig } from "payload";

import { heroModuleBlock, relatedPageModuleBlock } from "./payload-blocks.js";
import { montagePlugin } from "../../src/config/index.js";

import type { Block, SanitizedConfig } from "payload";

/**
 * Minimal Payload config exercising `montagePlugin`: it registers
 * `config.blocks`, and the `pages` collection's `layout` field references
 * those slugs, the way a real consumer would.
 */
export const buildFixtureConfig = (): Promise<SanitizedConfig> =>
	buildConfig({
		secret: "montage-integration-test",
		db: sqliteAdapter({ client: { url: ":memory:" } }),
		collections: [
			{
				slug: "pages",
				fields: [
					{ name: "title", type: "text", required: true },
					{
						name: "layout",
						type: "blocks",
						// Payload 3 types `blocks` as `Block[]` but accepts slugs at runtime.
						blocks: [
							"hero-module",
							"related-page-module",
						] as unknown as Block[],
					},
				],
			},
		],
		plugins: [
			montagePlugin({ blocks: [heroModuleBlock, relatedPageModuleBlock] }),
		],
		typescript: { autoGenerate: false },
		graphQL: { disable: true },
	});
