import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { describe, expect, it } from "vitest";

import { normalizeOptions, toCamelCase } from "./options.js";
import { BUILTIN_TOOLS } from "./tools/builtin.js";
import {
	pages,
	posts,
	snippets,
	tags,
	users,
} from "../test/fixtures/collections.js";
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
	normalizeOptions(
		config,
		options,
		BUILTIN_TOOLS.map((tool) => tool.name),
	);

describe("toCamelCase", () => {
	it("camel cases slugs", () => {
		expect(toCamelCase("my-pages")).toBe("myPages");
		expect(toCamelCase("Pages")).toBe("pages");
		expect(toCamelCase("short_links")).toBe("shortLinks");
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
		expect(normalized.serverInfo.name).toBe("payloadcms-mcpx");
		expect(normalized.diagnostics).toBe(true);
	});

	it("respects diagnostics: false", () => {
		expect(
			normalize({ collections: { pages: true }, diagnostics: false })
				.diagnostics,
		).toBe(false);
	});

	it("refuses an unknown collection", () => {
		expect(() => normalize({ collections: { nope: true } })).toThrow(
			/"nope" does not exist/,
		);
	});

	describe("true", () => {
		it("exposes everything an entity with drafts supports", () => {
			expect(normalize({ collections: { pages: true } }).collections).toEqual([
				{
					slug: "pages",
					read: true,
					write: true,
					publish: true,
					liveWrite: false,
					hasDrafts: true,
					hasVersions: true,
					delete: false,
					deleteUnattended: false,
					isUpload: false,
					fieldName: "pages",
				},
			]);
		});

		it("exposes a live write on an entity without drafts", () => {
			expect(normalize({ collections: { tags: true } }).collections).toEqual([
				{
					slug: "tags",
					read: true,
					write: true,
					publish: false,
					liveWrite: true,
					hasDrafts: false,
					hasVersions: false,
					delete: false,
					deleteUnattended: false,
					isUpload: false,
					fieldName: "tags",
				},
			]);
		});

		it("is the same as an empty object", () => {
			expect(normalize({ collections: { pages: {} } })).toEqual(
				normalize({ collections: { pages: true } }),
			);
		});

		it("derives hasVersions from the Payload versions of the entity", () => {
			expect(
				normalize({ collections: { pages: true } }, rawConfig([users, pages]))
					.collections[0],
			).toMatchObject({ hasDrafts: true, hasVersions: true });
			expect(
				normalize(
					{ collections: { snippets: true } },
					rawConfig([users, snippets]),
				).collections[0],
			).toMatchObject({ hasDrafts: false, hasVersions: true });
			expect(
				normalize({ collections: { tags: true } }).collections[0],
			).toMatchObject({ hasVersions: false });
		});

		it("leaves versions off, without an error, when read is off", () => {
			expect(
				normalize(
					{ collections: { snippets: { read: false } } },
					rawConfig([users, snippets]),
				).collections[0],
			).toMatchObject({ read: false, hasVersions: false });
		});

		it("exposes an upload collection, which still counts as writable", () => {
			const media: CollectionConfig = {
				slug: "media",
				upload: true,
				versions: { drafts: true },
				fields: [{ name: "alt", type: "text" }],
			};

			expect(
				normalize({ collections: { media: true } }, rawConfig([users, media]))
					.collections,
			).toEqual([
				{
					slug: "media",
					read: true,
					write: true,
					publish: true,
					liveWrite: false,
					hasDrafts: true,
					hasVersions: true,
					delete: false,
					deleteUnattended: false,
					isUpload: true,
					fieldName: "media",
				},
			]);
		});

		it("exposes a global the same way", () => {
			expect(
				normalize({
					collections: {},
					globals: { "site-settings": true, banner: true },
				}).globals,
			).toEqual([
				{
					slug: "site-settings",
					read: true,
					write: true,
					publish: true,
					liveWrite: false,
					hasDrafts: true,
					hasVersions: true,
					delete: false,
					deleteUnattended: false,
					isUpload: false,
					fieldName: "siteSettings",
				},
				{
					slug: "banner",
					read: true,
					write: true,
					publish: false,
					liveWrite: true,
					hasDrafts: false,
					hasVersions: false,
					delete: false,
					deleteUnattended: false,
					isUpload: false,
					fieldName: "banner",
				},
			]);
		});
	});

	describe("the options", () => {
		it("takes read: false away", () => {
			expect(
				normalize({ collections: { pages: { read: false } } }).collections[0],
			).toMatchObject({ read: false, write: false });
		});

		it("takes write: false away", () => {
			expect(
				normalize({ collections: { pages: { write: false } } }).collections[0],
			).toMatchObject({ write: false });
		});

		it("takes publish: false away", () => {
			expect(
				normalize({ collections: { pages: { publish: false } } })
					.collections[0],
			).toMatchObject({
				write: true,
				publish: false,
				liveWrite: false,
				hasDrafts: true,
			});
		});

		it("leaves delete off unless it is set", () => {
			const normalized = normalize({
				collections: { pages: true, tags: { delete: true } },
			});

			expect(normalized.collections.map((entry) => entry.delete)).toEqual([
				false,
				true,
			]);
			expect(normalized.confirmations).toBe(true);
			expect(normalize({ collections: { pages: true } }).confirmations).toBe(
				false,
			);
		});

		it("keeps drafts apart from the version history", () => {
			expect(
				normalize({ collections: { pages: { publish: false } } })
					.collections[0],
			).toMatchObject({ hasDrafts: true, hasVersions: true });
		});

		it("lets publish: false stand with write: false on an entity without drafts", () => {
			expect(
				normalize({ collections: { tags: { write: false, publish: false } } })
					.collections[0],
			).toMatchObject({
				write: false,
				publish: false,
				liveWrite: false,
				hasDrafts: false,
			});
		});

		it("ignores publish when write is off", () => {
			expect(
				normalize({ collections: { pages: { write: false, publish: false } } })
					.collections[0],
			).toMatchObject({ write: false });
		});

		it.each([
			["write: true", { write: true }],
			["publish: true", { publish: true }],
			["delete: true", { delete: true }],
		])("refuses read: false with %s", (_name, extra) => {
			expect(() =>
				normalize({ collections: { pages: { read: false, ...extra } } }),
			).toThrow(/read: false/);
		});
	});

	describe("the write flags", () => {
		const off = { write: false, publish: false, liveWrite: false };
		const drafted = { write: true, publish: false, liveWrite: false };
		const published = { write: true, publish: true, liveWrite: false };
		const live = { write: true, publish: false, liveWrite: true };

		it.each([
			["tags", { write: false }, off],
			["pages", { write: false }, off],
			["pages", {}, published],
			["pages", { publish: false }, drafted],
			["tags", {}, live],
		] as const)("maps %s with %j to %j", (slug, settings, expected) => {
			expect(
				normalize({ collections: { [slug]: settings } }).collections[0],
			).toMatchObject(expected);
		});

		it("maps a global the same way", () => {
			const flags = (global: string, settings: object) =>
				normalize({ collections: {}, globals: { [global]: settings } })
					.globals[0];

			expect(flags("site-settings", {})).toMatchObject(published);
			expect(flags("site-settings", { publish: false })).toMatchObject(drafted);
			expect(flags("banner", {})).toMatchObject(live);
			expect(flags("banner", { write: false })).toMatchObject(off);
		});
	});

	describe("startup errors", () => {
		it("refuses false as an entity value and says to remove the entry", () => {
			expect(() =>
				normalize({ collections: { pages: false as never } }),
			).toThrow(/"pages" is set to false. Remove the entry/);
			expect(() =>
				normalize({ collections: {}, globals: { banner: false as never } }),
			).toThrow(/Global "banner" is set to false. Remove the entry/);
		});

		it.each([["no"], [0], [[]], [null], [1]])(
			"refuses %j as an entity value",
			(value) => {
				expect(() =>
					normalize({ collections: { pages: value as never } }),
				).toThrow(/"pages" has .*Use true or an object of/);
			},
		);

		it("skips an entity whose value is undefined", () => {
			expect(
				normalize({ collections: { pages: undefined } }).collections,
			).toEqual([]);
		});

		it("refuses an unknown option and names the allowed ones", () => {
			const typo: Record<string, unknown> = { wirte: false };
			const unknown: Record<string, unknown> = { nope: true };

			expect(() => normalize({ collections: { pages: typo } })).toThrow(
				/unknown option "wirte".*read, write, publish/,
			);
			expect(() =>
				normalize({ collections: {}, globals: { banner: unknown } }),
			).toThrow(/Global "banner" has the unknown option "nope"/);
		});

		it("refuses delete on a global", () => {
			const deletable: Record<string, unknown> = { delete: true };

			expect(() =>
				normalize({ collections: {}, globals: { banner: deletable } }),
			).toThrow(/unknown option "delete".*read, write, publish\./);
		});

		it("accepts unattended deletes only on a collection with trash", () => {
			const bins: CollectionConfig = { slug: "bins", trash: true, fields: [] };
			const config = rawConfig([users, pages, tags, bins]);

			expect(
				normalize({ collections: { bins: { delete: "unattended" } } }, config)
					.collections[0],
			).toMatchObject({ delete: true, deleteUnattended: true });
			expect(() =>
				normalize({ collections: { tags: { delete: "unattended" } } }, config),
			).toThrow(/Collection "tags" has delete: "unattended" but no trash/);
		});

		it("refuses delete with a custom auth.resolve", () => {
			expect(() =>
				normalize({
					collections: { tags: { delete: true } },
					auth: { resolve: () => Promise.resolve(null) },
				}),
			).toThrow(/custom auth\.resolve/);
		});

		it("refuses an option that is not a boolean", () => {
			for (const name of ["read", "write", "publish"]) {
				const settings: Record<string, unknown> = { [name]: "yes" };

				expect(() =>
					normalize({
						collections: { pages: settings },
					}),
				).toThrow(new RegExp(`has ${name}: "yes". Use true or false`));
			}

			expect(() =>
				normalize({
					collections: {},
					globals: { banner: { read: 1 as unknown as boolean } },
				}),
			).toThrow(/Use true or false/);
		});

		it("names the replacement for the old write modes", () => {
			expect(() =>
				normalize({
					collections: { pages: { write: "draft" as unknown as boolean } },
				}),
			).toThrow(/write: "draft".*Use \{ publish: false \}/);
			expect(() =>
				normalize({
					collections: { pages: { write: "live" as unknown as boolean } },
				}),
			).toThrow(/write: "live".*on by default/);
		});

		it("refuses publish: true on an entity without drafts", () => {
			expect(() =>
				normalize({ collections: { tags: { publish: true } } }),
			).toThrow(/"tags" has no drafts.*publish: true/);
			expect(() =>
				normalize({ collections: {}, globals: { banner: { publish: true } } }),
			).toThrow(/"banner" has no drafts/);
		});

		it("refuses publish: false on an entity without drafts and names the fix", () => {
			expect(() =>
				normalize({ collections: { tags: { publish: false } } }),
			).toThrow(/"tags" has no drafts, so every write goes live.*write: false/);
			expect(() =>
				normalize({ collections: {}, globals: { banner: { publish: false } } }),
			).toThrow(/"banner" has no drafts/);
		});

		it("refuses publish: true with write: false", () => {
			expect(() =>
				normalize({ collections: { pages: { write: false, publish: true } } }),
			).toThrow(/publish: true but write: false/);
		});

		it("refuses versions as an unknown option", () => {
			const settings: Record<string, unknown> = { versions: true };

			expect(() => normalize({ collections: { pages: settings } })).toThrow(
				/unknown option "versions"/,
			);
		});

		it("refuses a write on a collection with a localized status and names the fix", () => {
			const config = rawConfig([
				users,
				{ ...pages, versions: { drafts: { localizeStatus: true } } },
			]);

			expect(() => normalize({ collections: { pages: true } }, config)).toThrow(
				/localizeStatus.*Set publish: false or write: false\./,
			);
			expect(
				normalize({ collections: { pages: { publish: false } } }, config)
					.collections[0],
			).toMatchObject({ write: true, publish: false });
			expect(
				normalize({ collections: { pages: { write: false } } }, config)
					.collections[0]?.write,
			).toBe(false);
		});
	});

	it("refuses write on auth and internal collections", () => {
		const config = rawConfig([users, pages]);

		expect(() =>
			normalize({ collections: { users: { write: true } } }, config),
		).toThrow(/Auth collection/);
		// Read is refused too: auth documents carry credentials.
		expect(() => normalize({ collections: { users: true } }, config)).toThrow(
			/Auth collection/,
		);
		expect(() =>
			normalize(
				{
					collections: { pages: { write: true } },
					apiKeys: { slug: "pages" },
				},
				config,
			),
		).toThrow(/already taken/);
	});

	it("refuses write on a collection without timestamps", () => {
		const config = rawConfig([users, { ...pages, timestamps: false }]);

		expect(() => normalize({ collections: { pages: true } }, config)).toThrow(
			/timestamps/,
		);
	});

	it("leaves globals empty when the option is omitted", () => {
		expect(normalize({ collections: { pages: true } }).globals).toEqual([]);
	});

	it("refuses an unknown global", () => {
		expect(() =>
			normalize({ collections: {}, globals: { nope: true } }),
		).toThrow(/Exposed global "nope" does not exist/);
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
