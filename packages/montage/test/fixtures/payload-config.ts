import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { buildConfig } from "payload";

import { heroModuleBlock, relatedPageModuleBlock } from "./payload-blocks.js";
import { montagePlugin } from "../../src/config/index.js";

import type { SanitizedConfig } from "payload";

/**
 * Minimal Payload config exercising `montagePlugin`: it registers
 * `config.blocks`. The `pages` collection's `layout` field declares the same
 * blocks inline, the one form Payload 3 and 4 both type the same way.
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
						blocks: [heroModuleBlock, relatedPageModuleBlock],
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
