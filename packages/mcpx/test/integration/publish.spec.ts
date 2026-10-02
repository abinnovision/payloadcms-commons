import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { collectionEnumOf, createMcpClient } from "./helpers/mcp.js";
import { bootPayload, seedKeysFor } from "./helpers/payload.js";
import { roguePublishTool } from "../fixtures/config.js";

import type { McpClient } from "./helpers/mcp.js";
import type { Booted } from "./helpers/payload.js";

const CACHE_KEY = "mcpx-integration-publish";

/** A page that satisfies every required field, so publishing it succeeds. */
const completePage = (title: string): Record<string, unknown> => ({
	title,
	slug: title.toLowerCase(),
	layout: {
		sections: [{ blockType: "sectionWrapper", identifier: title }],
	},
});

describe("publishDocument", () => {
	let booted: Booted;
	let publisher: McpClient;
	let writer: McpClient;

	const createPage = async (
		data: Record<string, unknown>,
	): Promise<number | string> => {
		const result = await publisher.call("createDocument", {
			collection: "pages",
			locale: "en",
			data,
		});

		expect(result.isError).toBe(false);

		return result.data["id"] as number | string;
	};

	const readPage = (id: number | string, draft: boolean) =>
		booted.payload.findByID({
			collection: "pages",
			id,
			draft,
			locale: "en",
			overrideAccess: true,
		});

	beforeAll(async () => {
		booted = await bootPayload({
			key: CACHE_KEY,
			plugin: {
				collections: {
					pages: { read: true, write: "live" },
					posts: { read: true, write: "draft" },
					tags: { read: true, write: "live" },
					notes: { read: true, write: "live" },
				},
				globals: {
					"site-settings": { read: true, write: "live" },
					banner: { read: true, write: "live" },
				},
				tools: [roguePublishTool],
			},
		});

		const { keys } = await seedKeysFor(booted.payload, {
			publisher: {
				collections: {
					pages: { read: true, write: true, publish: true },
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
				collections: { pages: { read: true, write: true } },
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
		expect(collectionEnumOf(publish)).toEqual(["pages", "notes"]);
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
		const id = await createPage(completePage("Draft"));

		const patched = await publisher.call("patchDocument", {
			collection: "pages",
			id,
			locale: "en",
			patches: [{ op: "replace", path: "/title", value: "Patched" }],
		});

		expect(patched.isError).toBe(false);
		expect((await readPage(id, false))["_status"]).toBe("draft");

		const published = await publisher.call("publishDocument", {
			collection: "pages",
			id,
		});

		expect(published.isError).toBe(false);
		expect(published.data).toMatchObject({ status: "published" });
		expect(await readPage(id, false)).toMatchObject({
			title: "Patched",
			_status: "published",
		});
	});

	it("publishes a global the same way", async () => {
		await publisher.call("patchDocument", {
			global: "site-settings",
			locale: "en",
			patches: [
				{ op: "replace", path: "/title", value: "Live" },
				{ op: "replace", path: "/tagline", value: "Tagline" },
			],
		});

		const published = await publisher.call("publishDocument", {
			global: "site-settings",
		});

		expect(published.isError).toBe(false);
		expect(
			await booted.payload.findGlobal({
				slug: "site-settings",
				draft: false,
				locale: "en",
				overrideAccess: true,
			}),
		).toMatchObject({ title: "Live", _status: "published" });
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

	it("refuses a document that would not validate, and leaves it a draft", async () => {
		const id = await createPage({ title: "Incomplete" });

		const result = await publisher.call("publishDocument", {
			collection: "pages",
			id,
		});

		expect(result.isError).toBe(true);
		expect(result.data["validationErrors"]).toBeDefined();
		expect((await readPage(id, true))["_status"]).toBe("draft");
	});

	it("refuses a stale expectedUpdatedAt", async () => {
		const id = await createPage(completePage("Concurrent"));

		const result = await publisher.call("publishDocument", {
			collection: "pages",
			id,
			expectedUpdatedAt: "2020-01-01T00:00:00.000Z",
		});

		expect(result.isError).toBe(true);
		expect((await readPage(id, true))["_status"]).toBe("draft");
	});

	it("refuses a key that may write but not publish", async () => {
		const id = await createPage(completePage("Forbidden"));

		const result = await writer.call("publishDocument", {
			collection: "pages",
			id,
		});

		expect(result.isError).toBe(true);
		expect((await readPage(id, true))["_status"]).toBe("draft");
	});

	it("keeps a publish that did not come through the tool from landing", async () => {
		const id = await createPage(completePage("Rogue"));

		/*
		 * On a collection the guard corrects rather than refuses: the operation
		 * is rewritten into a draft save, so the call succeeds and nothing is
		 * published.
		 */
		const collection = await publisher.call("roguePublish", {
			collection: "pages",
			id,
		});

		expect(collection.isError).toBe(false);
		expect((await readPage(id, false))["_status"]).toBe("draft");

		/*
		 * A global cannot be corrected, because updateGlobal reads `draft` before
		 * the hook runs, so the alarm is what stops it and it throws.
		 */
		const guarded = await publisher.call("roguePublish", {
			global: "site-settings",
		});

		expect(guarded.isError).toBe(true);
	});

	/*
	 * Both calls share one PayloadRequest, and the transport dispatches the
	 * messages of a batch without awaiting each one, so they overlap. They also
	 * name the same document, which is what makes this discriminating: an intent
	 * held anywhere but on the write itself is reachable by the patch, and the
	 * patch is then the write that goes live while the publish is refused.
	 */
	it("does not leak the publish intent to a sibling call in the same batch", async () => {
		const id = await createPage(completePage("Batched"));

		const results = await publisher.batch([
			{
				name: "patchDocument",
				args: {
					collection: "pages",
					id,
					locale: "en",
					patches: [{ op: "replace", path: "/title", value: "Still a draft" }],
				},
			},
			{ name: "publishDocument", args: { collection: "pages", id } },
		]);

		expect(results.map((result) => result.isError)).toEqual([false, false]);
		expect(await readPage(id, false)).toMatchObject({
			title: "Batched",
			_status: "published",
		});
	});
});
