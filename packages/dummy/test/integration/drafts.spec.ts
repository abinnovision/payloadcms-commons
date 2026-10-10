import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootPayload } from "./helpers/payload.js";
import { defineDummySeed } from "../../src/define-seed.js";
import { runDummySeeds } from "../../src/run.js";

import type { Payload } from "payload";

let payload: Payload;

beforeAll(async () => {
	({ payload } = await bootPayload({ key: "drafts" }));
});

afterAll(async () => {
	await payload.destroy();
});

describe("drafts", () => {
	it("publishes a draft-enabled collection without the seed asking", async () => {
		await runDummySeeds({
			payload,
			seeds: [
				defineDummySeed({
					id: "pages",
					run: async (ctx) => {
						await ctx.doc("pages", { slug: "/published", title: "Published" });
					},
				}),
			],
		});

		const found = await payload.find({
			collection: "pages",
			where: { slug: { equals: "/published" } },
			overrideAccess: true,
		});

		expect(found.docs[0]?.["_status"]).toBe("published");
	});

	it("leaves the document visible to a published-only query", async () => {
		await runDummySeeds({
			payload,
			seeds: [
				defineDummySeed({
					id: "pages",
					run: async (ctx) => {
						await ctx.doc("pages", { slug: "/visible", title: "Visible" });
					},
				}),
			],
		});

		const found = await payload.find({
			collection: "pages",
			where: { slug: { equals: "/visible" } },
			draft: false,
			overrideAccess: true,
		});

		expect(found.docs).toHaveLength(1);
	});

	it("stays published, with the new value, on a re-run", async () => {
		const seeds = (title: string) => [
			defineDummySeed({
				id: "pages",
				run: async (ctx) => {
					await ctx.doc("pages", { slug: "/rerun", title });
				},
			}),
		];

		await runDummySeeds({ payload, seeds: seeds("First") });
		await runDummySeeds({ payload, seeds: seeds("Renamed") });

		const found = await payload.find({
			collection: "pages",
			where: { slug: { equals: "/rerun" } },
			overrideAccess: true,
		});

		expect(found.docs[0]?.["_status"]).toBe("published");
		expect(found.docs[0]?.["title"]).toBe("Renamed");
	});

	it("writes a versioned collection without drafts live, and leaves a version", async () => {
		await runDummySeeds({
			payload,
			seeds: [
				defineDummySeed({
					id: "snippets",
					run: async (ctx) => {
						await ctx.doc("snippets", { key: "greeting", body: "Hello" });
					},
				}),
			],
		});

		const found = await payload.find({
			collection: "snippets",
			where: { key: { equals: "greeting" } },
			overrideAccess: true,
		});
		const versions = await payload.findVersions({
			collection: "snippets",
			overrideAccess: true,
		});

		// No `_status` at all: the collection has versions but no drafts.
		expect(found.docs[0]?.["_status"]).toBeUndefined();
		expect(found.docs[0]?.["body"]).toBe("Hello");
		expect(versions.docs.length).toBeGreaterThan(0);
	});

	it("writes a collection with no versions at all", async () => {
		await runDummySeeds({
			payload,
			seeds: [
				defineDummySeed({
					id: "tags",
					run: async (ctx) => {
						await ctx.doc("tags", { name: "Plain" });
					},
				}),
			],
		});

		const found = await payload.find({
			collection: "tags",
			where: { name: { equals: "Plain" } },
			overrideAccess: true,
		});

		expect(found.docs).toHaveLength(1);
	});
});
