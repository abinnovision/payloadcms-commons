import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { lexicalEditor } from "@payloadcms/richtext-lexical";
import { buildConfig } from "payload";
import { z } from "zod";

import { richTextBlock } from "./blocks.js";
import { pages, posts, tags, users } from "./collections.js";
import { banner, siteSettings } from "./globals.js";
import { defineMcpxTool, mcpxPlugin } from "../../src/index.js";

import type { McpxPluginOptions } from "../../src/index.js";
import type { SanitizedConfig } from "payload";

/**
 * Custom tool echoing what the handler can see about the caller.
 */
export const echoTool = defineMcpxTool({
	name: "echo",
	description: "Echoes a message together with the resolved user and key.",
	inputSchema: { message: z.string() },
	handler: ({ args, req }) => ({
		content: [
			{
				type: "text",
				text: JSON.stringify({
					message: args.message,
					userId: req.user?.id,
					apiKeyId: req.context.mcpx?.apiKeyId,
				}),
			},
		],
	}),
});

export const defaultPluginOptions: McpxPluginOptions = {
	collections: {
		pages: { read: true, write: true },
		posts: { read: true, write: true },
		tags: true,
	},
	tools: [echoTool],
};

/**
 * A sanitized config with the plugin applied. `sqliteAdapter` only connects
 * in `init`, so this is safe for unit tests that never call `getPayload`.
 */
export const buildFixtureConfig = (
	overrides: { plugin?: Partial<McpxPluginOptions> } = {},
): Promise<SanitizedConfig> =>
	buildConfig({
		secret: "mcpx-test-secret",
		db: sqliteAdapter({ client: { url: ":memory:" } }),
		editor: lexicalEditor(),
		localization: { locales: ["en", "de"], defaultLocale: "en" },
		blocks: [richTextBlock],
		collections: [users, pages, posts, tags],
		// Registered on the config but deliberately absent from
		// `defaultPluginOptions`: every existing spec then keeps running against
		// a collections-only plugin, which is what proves globals changed
		// nothing for deployments that do not use them. Globals specs opt in
		// through `overrides.plugin`.
		globals: [siteSettings, banner],
		plugins: [mcpxPlugin({ ...defaultPluginOptions, ...overrides.plugin })],
		typescript: { autoGenerate: false },
		graphQL: { disable: true },
	});
