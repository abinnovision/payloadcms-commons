import { payloadMajor } from "@internal/test-utils/payload-major";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { collectionEnumOf, createMcpClient } from "./helpers/mcp.js";
import { bootPayload, seedKeysFor, storedState } from "./helpers/payload.js";
import { roguePublishTool } from "../fixtures/config.js";

import type { McpClient } from "./helpers/mcp.js";
import type { Booted } from "./helpers/payload.js";
import type { CollectionConfig } from "payload";

const CACHE_KEY = "mcpx-integration-publish";

/**
 * Drafts and a localized required field without blocks, so these cases run
 * the same on both majors.
 */
const articles: CollectionConfig = {
	slug: "articles",
	versions: { drafts: true },
	fields: [
		{ name: "title", type: "text", required: true, localized: true },
		{ name: "slug", type: "text", required: true },
	],
};

/**
 * `_status` read with `locale: "all"` once every locale is live: one value on
 * Payload 3, one per locale on Payload 4.
 */
const PUBLISHED_EVERYWHERE =
	payloadMajor() === 3 ? "published" : { en: "published", de: "published" };

describe("publishDocument", () => {
	let booted: Booted;
	let publisher: McpClient;
	let writer: McpClient;

	const createArticle = async (
		data: Record<string, unknown>,
	): Promise<number | string> => {
		const result = await publisher.call("createDocument", {
			collection: "articles",
			locale: "en",
			data,
		});

		expect(result.isError).toBe(false);

		return result.data["id"] as number | string;
	};

	const patchArticle = async (
		id: number | string,
		locale: string,
		patches: Record<string, unknown>[],
	): Promise<void> => {
		const result = await publisher.call("patchDocument", {
			collection: "articles",
			id,
			locale,
			patches,
		});

		expect(result.isError).toBe(false);
	};

	/**
	 * An article that satisfies every required field in every locale, so
	 * publishing it succeeds.
	 */
	const completeArticle = async (title: string): Promise<number | string> => {
		const id = await createArticle({ title, slug: title.toLowerCase() });

		await patchArticle(id, "de", [
			{ op: "replace", path: "/title", value: `${title} DE` },
		]);

		return id;
	};

	const readArticle = (id: number | string, draft: boolean) =>
		booted.payload.findByID({
			collection: "articles",
			id,
			draft,
			locale: "en",
			overrideAccess: true,
		});

	const liveArticle = (id: number | string, locale: string) =>
		booted.payload.findByID({
			collection: "articles",
			id,
			draft: false,
			locale,
			fallbackLocale: false,
			overrideAccess: true,
		});

	const storedArticles = () =>
		storedState(booted.payload, { collections: ["articles"] });

	beforeAll(async () => {
		booted = await bootPayload({
			key: CACHE_KEY,
			collections: [articles],
			plugin: {
				collections: {
					articles: true,
					posts: { publish: false },
					tags: true,
					notes: true,
				},
				globals: {
					"site-settings": true,
					banner: true,
				},
				tools: [roguePublishTool],
			},
		});

		const { keys } = await seedKeysFor(booted.payload, {
			publisher: {
				collections: {
					articles: { read: true, write: true, publish: true },
					posts: { read: true, write: true },
					tags: { read: true, write: true },
					notes: { read: true, write: true, publish: true },
				},
				globals: {
					siteSettings: { read: true, write: true, publish: true },
					banner: { read: true, write: true },
				},
				tools: { roguePublish: true },
			},
			writer: {
				collections: { articles: { read: true, write: true } },
				globals: { siteSettings: { read: true, write: true } },
				tools: { roguePublish: true },
			},
		});

		publisher = createMcpClient(booted, keys.publisher);
		writer = createMcpClient(booted, keys.writer);
	});

	afterAll(async () => {
		await booted.payload.destroy();
	});

	it("appears only for a key that ticked the publish checkbox", async () => {
		expect(await publisher.names()).toContain("publishDocument");
		expect(await writer.names()).not.toContain("publishDocument");
	});

	it("offers only the slugs that have a draft to promote", async () => {
		const tools = await publisher.list();
		const publish = tools.find((tool) => tool.name === "publishDocument");

		// posts is draft-only, and tags is live but has no versions.
		expect(collectionEnumOf(publish)).toEqual(["articles", "notes"]);
	});

	/*
	 * With versions.drafts.validate the draft save already validates, so an
	 * invalid draft never reaches a publish and this tool's refusal path is
	 * unreachable for such a collection.
	 */
	it("cannot fail validation on a collection that validates its drafts", async () => {
		const rejected = await publisher.call("createDocument", {
			collection: "notes",
			locale: "en",
			data: {},
		});

		expect(rejected.isError).toBe(true);

		const created = await publisher.call("createDocument", {
			collection: "notes",
			locale: "en",
			data: { title: "Note" },
		});

		const published = await publisher.call("publishDocument", {
			collection: "notes",
			id: created.data["id"],
		});

		expect(published.isError).toBe(false);
		expect(published.data).toMatchObject({ status: "published" });
	});

	/*
	 * The contract the whole tool rests on: Payload's update loads the latest
	 * version, which is the draft, and backfills every field the write leaves
	 * out from it. If that ever changes, this publishes stale content silently.
	 */
	it("promotes the current draft rather than republishing old content", async () => {
		const id = await completeArticle("Draft");

		await patchArticle(id, "en", [
			{ op: "replace", path: "/title", value: "Patched" },
		]);
		expect((await readArticle(id, false))["_status"]).toBe("draft");

		const published = await publisher.call("publishDocument", {
			collection: "articles",
			id,
		});

		expect(published.isError).toBe(false);
		expect(published.data).toMatchObject({ status: "published" });
		expect(await readArticle(id, false)).toMatchObject({
			title: "Patched",
			_status: "published",
		});
	});

	it("publishes every locale of a document and lists them", async () => {
		const id = await completeArticle("Every");

		const published = await publisher.call("publishDocument", {
			collection: "articles",
			id,
		});

		expect(published.isError).toBe(false);
		expect(published.data).toMatchObject({
			status: "published",
			publishedLocales: ["en", "de"],
		});
		expect(published.data).not.toHaveProperty("otherLocaleBlockers");
		expect(
			await booted.payload.findByID({
				collection: "articles",
				id,
				draft: false,
				locale: "all",
				overrideAccess: true,
			}),
		).toMatchObject({
			title: { en: "Every", de: "Every DE" },
			_status: PUBLISHED_EVERYWHERE,
		});
	});

	it("publishes a global the same way", async () => {
		for (const [locale, title] of [
			["en", "Live"],
			["de", "Live DE"],
		]) {
			await publisher.call("patchDocument", {
				global: "site-settings",
				locale,
				patches: [
					{ op: "replace", path: "/title", value: title },
					{ op: "replace", path: "/tagline", value: "Tagline" },
				],
			});
		}

		const published = await publisher.call("publishDocument", {
			global: "site-settings",
		});

		expect(published.isError).toBe(false);
		expect(published.data).toMatchObject({ publishedLocales: ["en", "de"] });
		expect(
			await booted.payload.findGlobal({
				slug: "site-settings",
				draft: false,
				locale: "all",
				overrideAccess: true,
			}),
		).toMatchObject({
			title: { en: "Live", de: "Live DE" },
			_status: PUBLISHED_EVERYWHERE,
		});
	});

	/*
	 * `updateGlobal` merges the write onto a read it takes with the caller's
	 * fallbackLocale, which Payload defaults to the default locale. Publishing
	 * writes the main table, so a backfilled value would be persisted into the
	 * locale it was borrowed for.
	 */
	it("does not backfill one locale from another when publishing a global", async () => {
		for (const [locale, title] of [
			["en", "English"],
			["de", "Deutsch"],
		]) {
			await publisher.call("patchDocument", {
				global: "site-settings",
				locale,
				patches: [
					{ op: "replace", path: "/title", value: title },
					{ op: "replace", path: "/tagline", value: "Tagline" },
				],
			});
		}

		await publisher.call("publishDocument", { global: "site-settings" });

		const german = await booted.payload.findGlobal({
			slug: "site-settings",
			draft: false,
			locale: "de",
			fallbackLocale: false,
			overrideAccess: true,
		});

		expect(german).toMatchObject({ title: "Deutsch" });
	});

	it("lists the blockers of the other locales and still publishes one locale", async () => {
		const id = await completeArticle("Alpha");

		await publisher.call("publishDocument", { collection: "articles", id });
		await patchArticle(id, "de", [
			{ op: "replace", path: "/title", value: "" },
		]);

		const published = await publisher.call("publishDocument", {
			collection: "articles",
			id,
			locale: "en",
		});

		expect(published.isError).toBe(false);
		expect(published.data).toMatchObject({
			publishedLocales: ["en"],
			otherLocaleBlockers: [{ locale: "de", path: "/title" }],
		});
		expect(await readArticle(id, false)).toMatchObject({
			_status: "published",
		});
	});

	it("refuses to publish every locale while one has blockers", async () => {
		const id = await completeArticle("Gamma");

		await publisher.call("publishDocument", { collection: "articles", id });
		await patchArticle(id, "de", [
			{ op: "replace", path: "/title", value: "" },
		]);

		const before = await storedArticles();
		const result = await publisher.call("publishDocument", {
			collection: "articles",
			id,
		});

		expect(result.isError).toBe(true);
		expect(result.data["error"]).toContain('pass "locale"');
		expect(result.data["publishBlockers"]).toEqual([
			expect.objectContaining({ locale: "de", path: "/title" }),
		]);
		expect(await storedArticles()).toEqual(before);
	});

	/*
	 * A first publish covers every locale on both majors, whatever "locale"
	 * says, so a scoped first publish cannot leave a locale behind.
	 */
	it("takes a first publish with a locale through every locale", async () => {
		const id = await completeArticle("First");

		const published = await publisher.call("publishDocument", {
			collection: "articles",
			id,
			locale: "de",
		});

		expect(published.isError).toBe(false);
		expect(published.data).toMatchObject({ publishedLocales: ["en", "de"] });
		expect(await liveArticle(id, "en")).toMatchObject({ title: "First" });
		expect(await liveArticle(id, "de")).toMatchObject({ title: "First DE" });
	});

	it("refuses a first publish while a locale has blockers, and names them", async () => {
		const id = await createArticle({ title: "Lonely", slug: "lonely" });
		const before = await storedArticles();

		const result = await publisher.call("publishDocument", {
			collection: "articles",
			id,
			locale: "en",
		});

		expect(result.isError).toBe(true);
		expect(result.data["error"]).toContain("admin panel");
		expect(result.data["error"]).not.toContain('"locale"');
		expect(result.data["publishBlockers"]).toEqual([
			expect.objectContaining({ locale: "de", path: "/title" }),
		]);
		expect((await readArticle(id, true))["_status"]).toBe("draft");
		expect(await storedArticles()).toEqual(before);
	});

	it("publishes one locale and keeps the other locales as published", async () => {
		const id = await completeArticle("Beta");

		await publisher.call("publishDocument", { collection: "articles", id });

		for (const [locale, patches] of [
			[
				"en",
				[
					{ op: "replace", path: "/title", value: "Beta changed" },
					{ op: "replace", path: "/slug", value: "changed" },
				],
			],
			["de", [{ op: "replace", path: "/title", value: "Beta DE" }]],
		] as const) {
			await patchArticle(id, locale, [...patches]);
		}

		const published = await publisher.call("publishDocument", {
			collection: "articles",
			id,
			locale: "de",
		});

		expect(published.isError).toBe(false);
		expect(published.data).toMatchObject({ publishedLocales: ["de"] });

		// Non-localized fields go live from the draft, whichever locale is scoped.
		expect(await liveArticle(id, "de")).toMatchObject({ title: "Beta DE" });
		expect(await liveArticle(id, "en")).toMatchObject({
			title: "Beta",
			slug: "changed",
		});
	});

	it("publishes one locale of a global and keeps the other locales as published", async () => {
		const patch = async (locale: string, title: string, tagline?: string) =>
			await publisher.call("patchDocument", {
				global: "site-settings",
				locale,
				patches: [
					{ op: "replace", path: "/title", value: title },
					...(tagline === undefined
						? []
						: [{ op: "replace", path: "/tagline", value: tagline }]),
				],
			});

		await patch("en", "Scoped A", "Tagline A");
		await patch("de", "Scoped A de");
		await publisher.call("publishDocument", { global: "site-settings" });
		await patch("en", "Scoped B", "Tagline B");
		await patch("de", "Scoped B de");

		const published = await publisher.call("publishDocument", {
			global: "site-settings",
			locale: "de",
		});

		expect(published.isError).toBe(false);

		const live = (locale: string) =>
			booted.payload.findGlobal({
				slug: "site-settings",
				draft: false,
				locale,
				fallbackLocale: false,
				overrideAccess: true,
			});

		expect(await live("de")).toMatchObject({ title: "Scoped B de" });
		expect(await live("en")).toMatchObject({
			title: "Scoped A",
			tagline: "Tagline B",
		});
	});

	it("refuses a locale that would not validate, and leaves it a draft", async () => {
		const id = await completeArticle("Incomplete");

		await publisher.call("publishDocument", { collection: "articles", id });
		await patchArticle(id, "en", [{ op: "replace", path: "/slug", value: "" }]);

		const before = await storedArticles();
		const result = await publisher.call("publishDocument", {
			collection: "articles",
			id,
			locale: "en",
		});

		expect(result.isError).toBe(true);
		expect(
			(result.data["validationErrors"] as { path: string }[]).map(
				(error) => error.path,
			),
		).toEqual(["/slug"]);
		expect((await readArticle(id, true))["_status"]).toBe("draft");
		expect(await storedArticles()).toEqual(before);
	});

	it("refuses a stale expectedUpdatedAt", async () => {
		const id = await completeArticle("Concurrent");
		const before = await storedArticles();

		const result = await publisher.call("publishDocument", {
			collection: "articles",
			id,
			expectedUpdatedAt: "2020-01-01T00:00:00.000Z",
		});

		expect(result.isError).toBe(true);
		expect((await readArticle(id, true))["_status"]).toBe("draft");
		expect(await storedArticles()).toEqual(before);
	});

	it("keeps a publish that did not come through the tool from landing", async () => {
		const id = await completeArticle("Rogue");

		/*
		 * On a collection the guard corrects rather than refuses: the operation
		 * is rewritten into a draft save, so the call succeeds and nothing is
		 * published.
		 */
		const collection = await publisher.call("roguePublish", {
			collection: "articles",
			id,
		});

		expect(collection.isError).toBe(false);
		expect((await readArticle(id, false))["_status"]).toBe("draft");

		/*
		 * A global cannot be corrected, because updateGlobal reads `draft` before
		 * the hook runs, so the guard throws instead.
		 */
		const settingsBefore = await storedState(booted.payload, {
			globals: ["site-settings"],
		});
		const guarded = await publisher.call("roguePublish", {
			global: "site-settings",
		});

		expect(guarded.isError).toBe(true);
		expect(
			await storedState(booted.payload, { globals: ["site-settings"] }),
		).toEqual(settingsBefore);
	});

	/*
	 * Both calls share one PayloadRequest and name the same document. An intent
	 * held anywhere but on the publish write itself would still be reachable by
	 * the patch that follows, which would then go live.
	 */
	it("does not leak the publish intent to a sibling call in the same batch", async () => {
		const id = await completeArticle("Batched");

		const results = await publisher.batch([
			{ name: "publishDocument", args: { collection: "articles", id } },
			{
				name: "patchDocument",
				args: {
					collection: "articles",
					id,
					locale: "en",
					patches: [{ op: "replace", path: "/title", value: "Still a draft" }],
				},
			},
		]);

		expect(results.map((result) => result.isError)).toEqual([false, false]);
		expect(await readArticle(id, false)).toMatchObject({
			title: "Batched",
			_status: "published",
		});
	});
});
