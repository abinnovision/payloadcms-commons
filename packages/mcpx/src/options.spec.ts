import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { describe, expect, it } from "vitest";

import { normalizeOptions, toCamelCase } from "./options.js";
import { BUILTIN_TOOLS } from "./tools/index.js";
import { BUILTIN_TOOL_NAMES } from "./tools/names.js";
import { pages, posts, tags, users } from "../test/fixtures/collections.js";
import { banner, siteSettings } from "../test/fixtures/globals.js";

import type { McpxPluginOptions } from "./types.js";
import type { CollectionConfig, Config, GlobalConfig } from "payload";

const rawConfig = (
	collections: CollectionConfig[] = [users, pages, posts, tags],
	globals: GlobalConfig[] = [siteSettings, banner],
): Config => ({
	secret: "secret",
	db: sqliteAdapter({ client: { url: ":memory:" } }),
	collections,
	globals,
});

const normalize = (options: McpxPluginOptions, config = rawConfig()) =>
	normalizeOptions(config, options);

describe("toCamelCase", () => {
	it("camel cases slugs", () => {
		expect(toCamelCase("my-pages")).toBe("myPages");
		expect(toCamelCase("Pages")).toBe("pages");
		expect(toCamelCase("short_links")).toBe("shortLinks");
	});
});

describe("bUILTIN_TOOL_NAMES", () => {
	it("names every builtin tool", () => {
		expect([...BUILTIN_TOOL_NAMES]).toEqual(
			BUILTIN_TOOLS.map((tool) => tool.name),
		);
	});
});

describe("normalizeOptions", () => {
	it("applies defaults", () => {
		const normalized = normalize({ collections: { pages: true } });

		expect(normalized).toMatchObject({
			apiKeysSlug: "mcpx-api-keys",
			endpointPath: "/mcpx",
			limits: { maxLimit: 25, maxDepth: 1 },
			userCollection: "users",
			tools: [],
		});
		expect(normalized.collections).toEqual([
			{
				slug: "pages",
				read: true,
				write: false,
				allowLiveWrites: false,
				hasDrafts: true,
				fieldName: "pages",
			},
		]);
		expect(normalized.serverInfo.name).toBe("payloadcms-mcpx");
	});

	it("refuses an unknown collection", () => {
		expect(() => normalize({ collections: { nope: true } })).toThrow(
			/"nope" does not exist/,
		);
	});

	it("refuses write on a collection without drafts", () => {
		expect(() => normalize({ collections: { tags: { write: true } } })).toThrow(
			/no drafts/,
		);
	});

	it("accepts write on a collection without drafts when live writes are allowed", () => {
		const [tags] = normalize({
			collections: { tags: { write: true, allowLiveWrites: true } },
		}).collections;

		expect(tags).toMatchObject({
			write: true,
			hasDrafts: false,
			allowLiveWrites: true,
		});
	});

	it("refuses write on auth, upload and internal collections", () => {
		const media: CollectionConfig = {
			slug: "media",
			upload: true,
			versions: { drafts: true },
			fields: [],
		};
		const config = rawConfig([users, media, pages]);

		expect(() =>
			normalize({ collections: { users: { write: true } } }, config),
		).toThrow(/Auth collection/);
		// Read is refused too: auth documents carry credentials.
		expect(() => normalize({ collections: { users: true } }, config)).toThrow(
			/Auth collection/,
		);
		expect(() =>
			normalize({ collections: { media: { write: true } } }, config),
		).toThrow(/Upload collection/);
		expect(() =>
			normalize(
				{ collections: { pages: { write: true } }, apiKeys: { slug: "pages" } },
				config,
			),
		).toThrow(/already taken/);
	});

	it("refuses write on a collection without timestamps", () => {
		const config = rawConfig([users, { ...pages, timestamps: false }]);

		expect(() =>
			normalize({ collections: { pages: { write: true } } }, config),
		).toThrow(/timestamps/);
	});

	it("leaves globals empty when the option is omitted", () => {
		expect(normalize({ collections: { pages: true } }).globals).toEqual([]);
	});

	it("applies global defaults", () => {
		expect(
			normalize({ collections: {}, globals: { "site-settings": true } })
				.globals,
		).toEqual([
			{
				slug: "site-settings",
				read: true,
				write: false,
				allowLiveWrites: false,
				hasDrafts: true,
				fieldName: "siteSettings",
			},
		]);
	});

	it("refuses an unknown global", () => {
		expect(() =>
			normalize({ collections: {}, globals: { nope: true } }),
		).toThrow(/Exposed global "nope" does not exist/);
	});

	it("refuses write on a global without drafts", () => {
		expect(() =>
			normalize({ collections: {}, globals: { banner: { write: true } } }),
		).toThrow(/Global "banner" has no drafts/);
	});

	it("accepts write on a global without drafts when live writes are allowed", () => {
		const [entry] = normalize({
			collections: {},
			globals: { banner: { write: true, allowLiveWrites: true } },
		}).globals;

		expect(entry).toMatchObject({
			write: true,
			hasDrafts: false,
			allowLiveWrites: true,
		});
	});

	it("lets a global and a collection share a capability field name", () => {
		const settings: GlobalConfig = { slug: "settings", fields: [] };
		const collection: CollectionConfig = { slug: "settings", fields: [] };
		const config = rawConfig([users, collection], [settings]);

		// Separate capability groups, so the two never collide.
		const normalized = normalize(
			{ collections: { settings: true }, globals: { settings: true } },
			config,
		);

		expect(normalized.collections[0]?.fieldName).toBe("settings");
		expect(normalized.globals[0]?.fieldName).toBe("settings");
	});

	it("refuses two globals mapping to the same capability field name", () => {
		const config = rawConfig(
			[users],
			[
				{ slug: "site-settings", fields: [] },
				{ slug: "site_settings", fields: [] },
			],
		);

		expect(() =>
			normalize(
				{
					collections: {},
					globals: { "site-settings": true, site_settings: true },
				},
				config,
			),
		).toThrow(/another exposed global already uses/);
	});

	it("requires an existing auth user collection", () => {
		expect(() =>
			normalize({ collections: {}, userCollection: "nope" }),
		).toThrow(/does not exist/);
		expect(() =>
			normalize({ collections: {}, userCollection: "tags" }),
		).toThrow(/not an auth collection/);
	});

	it("validates custom tool names", () => {
		const tool = (name: string) => ({
			name,
			description: "",
			handler: () => ({ content: [] }),
		});

		expect(() =>
			normalize({ collections: {}, tools: [tool("bad-name")] }),
		).toThrow(/must match/);
		expect(() =>
			normalize({ collections: {}, tools: [tool("patchDocument")] }),
		).toThrow(/reserved/);
		expect(() =>
			normalize({ collections: {}, tools: [tool("echo"), tool("echo")] }),
		).toThrow(/used twice/);
	});

	it("refuses capability field name collisions", () => {
		const config = rawConfig([users, pages, { ...pages, slug: "Pages" }]);

		expect(() =>
			normalize({ collections: { pages: true, Pages: true } }, config),
		).toThrow(/capability field/);
	});

	it("enables the setup guide by default", () => {
		expect(normalize({ collections: {} }).setupGuide).toBe(true);
		expect(
			normalize({ collections: {}, apiKeys: { setupGuide: false } }).setupGuide,
		).toBe(false);
	});

	it("validates limits", () => {
		expect(() =>
			normalize({ collections: {}, limits: { maxLimit: 0 } }),
		).toThrow(/limits/);
		expect(() =>
			normalize({ collections: {}, limits: { maxDepth: -1 } }),
		).toThrow(/limits/);
		expect(
			normalize({ collections: {}, limits: { maxDepth: 0 } }).limits.maxDepth,
		).toBe(0);
	});
});
