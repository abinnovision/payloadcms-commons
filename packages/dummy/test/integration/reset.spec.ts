import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootPayload, storedState } from "./helpers/payload.js";
import { defineDummySeed } from "../../src/define-seed.js";
import { runDummySeeds } from "../../src/run.js";

import type { Payload } from "payload";

let payload: Payload;

beforeAll(async () => {
	({ payload } = await bootPayload({ key: "reset" }));
});

afterAll(async () => {
	await payload.destroy();
});

const seeds = [
	defineDummySeed({
		id: "content",
		run: async (ctx) => {
			await ctx.doc("pages", { slug: "/", title: "Home" });
			await ctx.doc("tags", { name: "Kept" });
		},
	}),
];

const count = async (collection: "pages" | "tags"): Promise<number> => {
	const found = await payload.find({
		collection,
		limit: 0,
		pagination: false,
		overrideAccess: true,
	});

	return found.docs.length;
};

describe("fresh runs", () => {
	it("does not delete anything when fresh is not asked for", async () => {
		await runDummySeeds({ payload, seeds });
		await runDummySeeds({ payload, seeds, resetCollections: ["pages"] });

		expect(await count("pages")).toBe(1);
	});

	it("clears only the named collections", async () => {
		await runDummySeeds({
			payload,
			seeds: [
				defineDummySeed({
					id: "extra",
					run: async (ctx) => {
						await ctx.doc("pages", { slug: "/gone", title: "Gone" });
						await ctx.doc("tags", { name: "Also kept" });
					},
				}),
			],
		});

		await runDummySeeds({
			payload,
			seeds,
			fresh: true,
			resetCollections: ["pages"],
		});

		const pages = await payload.find({
			collection: "pages",
			limit: 0,
			pagination: false,
			overrideAccess: true,
		});
		const tags = await payload.find({
			collection: "tags",
			limit: 0,
			pagination: false,
			overrideAccess: true,
		});

		// Only what the seed declares survives in pages.
		expect(pages.docs.map((doc) => doc["slug"])).toEqual(["/"]);
		// tags was not named, so everything in it is untouched.
		expect(tags.docs.map((doc) => doc["name"])).toContain("Also kept");
	});

	it("reports what it deleted", async () => {
		// Seed first, so there is a known number of documents to clear.
		await runDummySeeds({ payload, seeds });

		const before = await count("pages");
		const result = await runDummySeeds({
			payload,
			seeds,
			fresh: true,
			resetCollections: ["pages"],
		});

		expect(result.writes.get("pages")).toMatchObject({ deleted: before });
	});

	it("clears a trashed document too", async () => {
		const page = await payload.create({
			collection: "pages",
			data: { slug: "/trashed", title: "Trashed", _status: "published" },
			overrideAccess: true,
		});

		await payload.update({
			collection: "pages",
			id: page.id,
			data: { deletedAt: new Date().toISOString() },
			overrideAccess: true,
		});

		await runDummySeeds({
			payload,
			seeds,
			fresh: true,
			resetCollections: ["pages"],
		});

		const withTrashed = await payload.find({
			collection: "pages",
			limit: 0,
			pagination: false,
			trash: true,
			overrideAccess: true,
		});

		expect(withTrashed.docs).toHaveLength(1);
	});

	it("leaves the same state as a run against an empty database", async () => {
		const fresh = {
			payload,
			seeds,
			fresh: true,
			resetCollections: ["pages", "tags"] as const,
		};

		await runDummySeeds({
			...fresh,
			resetCollections: [...fresh.resetCollections],
		});

		const first = await storedState(payload, {
			collections: ["pages", "tags"],
		});

		await runDummySeeds({
			...fresh,
			resetCollections: [...fresh.resetCollections],
		});

		// Ids differ after a delete, so the comparison is on content.
		const second = await storedState(payload, {
			collections: ["pages", "tags"],
		});
		const names = (state: Record<string, unknown>): unknown =>
			JSON.stringify(state, (key, value) => (key === "id" ? "*" : value));

		expect(names(second)).toEqual(names(first));
	});
});
