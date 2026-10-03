import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { lexicalEditor } from "@payloadcms/richtext-lexical";
import { buildConfig } from "payload";
import { z } from "zod";

import { calloutBlock, richTextBlock } from "./blocks.js";
import {
	media,
	notes,
	pages,
	posts,
	snippets,
	tags,
	users,
} from "./collections.js";
import { banner, siteSettings } from "./globals.js";
import { defineMcpxTool, mcpxPlugin } from "../../src/index.js";

import type { McpxPluginOptions } from "../../src/index.js";
import type {
	CollectionConfig,
	DatabaseAdapterObj,
	FlattenedField,
	SanitizedConfig,
} from "payload";

/**
 * Custom tool echoing what the handler can see about the caller.
 */
const echoTool = defineMcpxTool({
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

/**
 * Custom tool taking the builtin route in full: its input shape is built per
 * request so the `collection` enum is narrowed to what the key may read, and
 * it decides for itself when to register. Overriding `isEnabled` replaces the
 * checkbox check, so the checkbox is restated here.
 */
const whichCollectionTool = defineMcpxTool({
	name: "whichCollection",
	description: "Echoes back one of the collections this key may read.",
	isEnabled: (scope) =>
		scope.capabilities.tools["whichCollection"] === true &&
		scope.collections.readable.length > 0,
	inputSchema: (scope) => ({
		collection: z.enum(scope.collections.readable as [string, ...string[]]),
	}),
	handler: ({ args }) => ({
		content: [{ type: "text", text: JSON.stringify(args) }],
	}),
});

/**
 * Custom tool trying to publish behind the plugin's back, which is what the
 * draft guard exists to refuse. Reaches both a collection and a global,
 * because the two are guarded at different points in the operation.
 */
export const roguePublishTool = defineMcpxTool({
	name: "roguePublish",
	description: "Tries to publish without going through publishDocument.",
	inputSchema: {
		collection: z.string().optional(),
		id: z.union([z.string(), z.number()]).optional(),
		global: z.string().optional(),
	},
	handler: async ({ args, req }) => {
		const shared = {
			data: { _status: "published" },
			draft: false,
			overrideAccess: false,
			req,
		};

		if (args.global === undefined) {
			await req.payload.update({
				...shared,
				collection: args.collection as never,
				id: args.id as number | string,
			});
		} else {
			await req.payload.updateGlobal({ ...shared, slug: args.global as never });
		}

		return { content: [{ type: "text", text: "published" }] };
	},
});

const defaultPluginOptions: McpxPluginOptions = {
	collections: {
		pages: { publish: false },
		posts: { publish: false },
		tags: { write: false },
	},
	tools: [echoTool, whichCollectionTool],
};

/**
 * A sanitized config with the plugin applied. `sqliteAdapter` only connects
 * in `init`, so this is safe for unit tests that never call `getPayload`.
 *
 * `users` replaces the fixture user collection, `collections` is appended to
 * the fixture collections and `db` replaces the in-memory adapter; without
 * them the config is unchanged.
 */
export const buildFixtureConfig = (
	overrides: {
		plugin?: Partial<McpxPluginOptions>;
		users?: CollectionConfig;
		collections?: CollectionConfig[];
		db?: DatabaseAdapterObj;
	} = {},
): Promise<SanitizedConfig> =>
	buildConfig({
		secret: "mcpx-test-secret",
		db: overrides.db ?? sqliteAdapter({ client: { url: ":memory:" } }),
		editor: lexicalEditor(),
		localization: { locales: ["en", "de"], defaultLocale: "en" },
		blocks: [calloutBlock, richTextBlock],
		collections: [
			overrides.users ?? users,
			pages,
			posts,
			tags,
			notes,
			media,
			snippets,
			...(overrides.collections ?? []),
		],
		/*
		 * Registered on the config but absent from `defaultPluginOptions`, so the
		 * default plugin exposes collections only. Globals and upload specs opt
		 * in through `overrides.plugin`.
		 */
		globals: [siteSettings, banner],
		plugins: [mcpxPlugin({ ...defaultPluginOptions, ...overrides.plugin })],
		typescript: { autoGenerate: false },
		graphQL: { disable: true },
	});

/** A top-level field of a collection in `config`, by name. */
export const fieldOf = (
	config: SanitizedConfig,
	slug: string,
	name: string,
): FlattenedField | undefined =>
	config.collections
		.find((collection) => collection.slug === slug)
		?.flattenedFields.find(
			(candidate) => "name" in candidate && candidate.name === name,
		);
