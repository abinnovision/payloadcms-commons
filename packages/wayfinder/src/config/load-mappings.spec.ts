import { describe, expect, it } from "vitest";

import { loadMappings } from "./load-mappings.js";
import { DEFAULT_LOCALE_KEY } from "../pattern/types.js";

import type { MappingCache } from "./load-mappings.js";
import type { PayloadCollectionMappingResolved } from "../pattern/types.js";
import type { Payload } from "payload";

/**
 * Everything `loadMappings` touches on a Payload instance. A real instance
 * would need a database and a config just to return the object below.
 *
 * `config.localization` is here because the read derives the mapping's shape
 * from it rather than being told: these fixtures author one pattern per
 * locale, so the instance they claim to come from declares locales.
 */
const fakePayload = (global: unknown): Payload =>
	({
		findGlobal: () => Promise.resolve(global),
		collections: {},
		config: {
			localization: { locales: [{ code: "en" }, { code: "de" }] },
			globals: [{ slug: "collections-mapping" }],
		},
	}) as unknown as Payload;

/** The same instance without a `localization` block. */
const unlocalizedPayload = (global: unknown): Payload =>
	({
		findGlobal: () => Promise.resolve(global),
		collections: {},
		config: { localization: false, globals: [{ slug: "collections-mapping" }] },
	}) as unknown as Payload;

/** A fresh cache per call, so the module-level memo cannot leak across tests. */
const freshCache = (): MappingCache => {
	const store = new Map<string, PayloadCollectionMappingResolved[]>();

	return {
		get: (key) => store.get(key),
		set: (key, value) => void store.set(key, value),
	};
};

describe("loadMappings", () => {
	/*
	 * Every project is in this state on its first boot: routing should degrade
	 * to "nothing matches", not crash on the way to the admin panel where an
	 * editor would fix it.
	 */
	it("returns an empty list for a global that was never saved", async () => {
		await expect(
			loadMappings({ payload: fakePayload({}), cache: freshCache() }),
		).resolves.toEqual([]);
	});

	it("returns an empty list when the global is missing entirely", async () => {
		await expect(
			loadMappings({ payload: fakePayload(undefined), cache: freshCache() }),
		).resolves.toEqual([]);
	});

	it("compiles a per-locale row", async () => {
		const mappings = await loadMappings({
			payload: fakePayload({
				collections: [
					{ collectionName: "articles", path: { en: "/journal/:slug" } },
				],
			}),
			cache: freshCache(),
		});

		expect(mappings).toHaveLength(1);
		expect(mappings[0]?.collection).toBe("articles");
		expect(mappings[0]?.resolvers["en"]?.build({ slug: "hello-world" })).toBe(
			"/journal/hello-world",
		);
	});

	it("skips a row with no collection name", async () => {
		await expect(
			loadMappings({
				payload: fakePayload({
					collections: [
						{ path: { en: "/journal/:slug" } },
						{ collectionName: "", path: { en: "/notes/:slug" } },
					],
				}),
				cache: freshCache(),
			}),
		).resolves.toEqual([]);
	});

	it("skips a row with no path", async () => {
		await expect(
			loadMappings({
				payload: fakePayload({
					collections: [
						{ collectionName: "articles" },
						{ collectionName: "notes", path: {} },
						{ collectionName: "pages", path: { en: "" } },
					],
				}),
				cache: freshCache(),
			}),
		).resolves.toEqual([]);
	});

	it("keeps only the locales that actually have a pattern", async () => {
		const mappings = await loadMappings({
			payload: fakePayload({
				collections: [
					{
						collectionName: "articles",
						path: { en: "/journal/:slug", de: "" },
					},
				],
			}),
			cache: freshCache(),
		});

		expect(mappings[0]?.path).toEqual({ en: "/journal/:slug" });
	});

	/*
	 * Payload returns a scalar rather than a per-locale record for a project
	 * with no `localization` block.
	 */
	it("accepts a scalar path when localization is off", async () => {
		const mappings = await loadMappings({
			payload: fakePayload({
				collections: [{ collectionName: "pages", path: "/*permalink" }],
			}),
			localized: false,
			cache: freshCache(),
		});

		expect(mappings).toHaveLength(1);
		expect(Object.keys(mappings[0]?.resolvers ?? {})).toHaveLength(1);
	});

	it("ignores a `collections` value that is not an array", async () => {
		await expect(
			loadMappings({
				payload: fakePayload({ collections: "not-an-array" }),
				cache: freshCache(),
			}),
		).resolves.toEqual([]);
	});

	// A pattern saved before validation tightened must not take routing down.
	it("skips an unparseable pattern rather than throwing", async () => {
		const mappings = await loadMappings({
			payload: fakePayload({
				collections: [
					{ collectionName: "notes", path: { en: "/:" } },
					{ collectionName: "articles", path: { en: "/journal/:slug" } },
				],
			}),
			cache: freshCache(),
		});

		expect(mappings.map((it) => it.collection)).toEqual(["articles"]);
	});

	it("returns the cached compilation instead of recompiling", async () => {
		const cache = freshCache();
		const payload = fakePayload({
			collections: [
				{ collectionName: "articles", path: { en: "/journal/:slug" } },
			],
		});

		const first = await loadMappings({ payload, cache });
		const second = await loadMappings({ payload, cache });

		expect(second).toBe(first);
	});

	it("consults the supplied cache before compiling anything", async () => {
		const sentinel: PayloadCollectionMappingResolved[] = [];
		const asked: string[] = [];
		const cache: MappingCache = {
			get: (key) => {
				asked.push(key);

				return sentinel;
			},
			set: () => undefined,
		};

		const result = await loadMappings({
			payload: fakePayload({
				collections: [
					{ collectionName: "articles", path: { en: "/journal/:slug" } },
				],
			}),
			cache,
		});

		expect(result).toBe(sentinel);
		expect(asked).toHaveLength(1);
	});

	it("keys the cache on the authored mapping, so a change misses", async () => {
		const cache = freshCache();

		const first = await loadMappings({
			payload: fakePayload({
				collections: [
					{ collectionName: "articles", path: { en: "/journal/:slug" } },
				],
			}),
			cache,
		});
		const second = await loadMappings({
			payload: fakePayload({
				collections: [
					{ collectionName: "articles", path: { en: "/archive/:slug" } },
				],
			}),
			cache,
		});

		expect(second).not.toBe(first);
		expect(second[0]?.path).toEqual({ en: "/archive/:slug" });
	});
});

describe("loadMappings localization", () => {
	/*
	 * The shape of the stored `path` follows the config: a scalar without a
	 * `localization` block, a per-locale record with one. Deriving it from the
	 * instance is what keeps the read in step with what the plugin wrote —
	 * being told separately meant the two could disagree, and a disagreement
	 * read a scalar as a record and matched nothing at all.
	 */
	it("reads a scalar path when the instance declares no locales", async () => {
		const mappings = await loadMappings({
			payload: unlocalizedPayload({
				collections: [{ collectionName: "pages", path: "/:slug" }],
			}),
			cache: freshCache(),
		});

		expect(mappings[0]?.path).toEqual({ [DEFAULT_LOCALE_KEY]: "/:slug" });
	});

	it("reads a per-locale path when the instance declares locales", async () => {
		const mappings = await loadMappings({
			payload: fakePayload({
				collections: [
					{ collectionName: "pages", path: { en: "/:slug", de: "/:slug" } },
				],
			}),
			cache: freshCache(),
		});

		expect(mappings[0]?.path).toEqual({ en: "/:slug", de: "/:slug" });
	});

	// The derivation is a default, not a rule: an exotic setup can still say.
	it("lets an explicit argument override the derived value", async () => {
		const mappings = await loadMappings({
			payload: unlocalizedPayload({
				collections: [{ collectionName: "pages", path: { en: "/:slug" } }],
			}),
			localized: true,
			cache: freshCache(),
		});

		expect(mappings[0]?.path).toEqual({ en: "/:slug" });
	});
});

describe("loadMappings identifier fallback", () => {
	/*
	 * The write side validates a pattern against this and the read side
	 * compiles mappings with it. Stating it twice is what let them disagree:
	 * a project keyed by `handle` that told only the read side found the
	 * admin panel refusing to save the very pattern it had configured for.
	 */
	const withDeclared = (global: unknown, declared?: string): Payload =>
		({
			findGlobal: () => Promise.resolve(global),
			collections: {},
			config: {
				localization: false,
				globals: [
					{
						slug: "collections-mapping",
						...(declared
							? { custom: { wayfinder: { fallbackIdentifierField: declared } } }
							: {}),
					},
				],
			},
		}) as unknown as Payload;

	const rows = { collections: [{ collectionName: "pages", path: "/:slug" }] };

	it("reads what the mapping global was declared with", async () => {
		const mappings = await loadMappings({
			payload: withDeclared(rows, "handle"),
			cache: freshCache(),
		});

		expect(mappings[0]?.fallbackIdentifierField).toBe("handle");
	});

	it("falls back to the default when the global declares nothing", async () => {
		const mappings = await loadMappings({
			payload: withDeclared(rows),
			cache: freshCache(),
		});

		expect(mappings[0]?.fallbackIdentifierField).toBe("slug");
	});

	it("lets an explicit argument override the declaration", async () => {
		const mappings = await loadMappings({
			payload: withDeclared(rows, "handle"),
			fallbackIdentifierField: "permalink",
			cache: freshCache(),
		});

		expect(mappings[0]?.fallbackIdentifierField).toBe("permalink");
	});
});
