import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootPayload, recorder, storedState } from "./helpers/payload.js";
import { defineDummySeed } from "../../src/define-seed.js";
import { runDummySeeds } from "../../src/run.js";

import type { Payload } from "payload";

let payload: Payload;

beforeAll(async () => {
	({ payload } = await bootPayload({ key: "upsert" }));
});

afterAll(async () => {
	await payload.destroy();
});

/*
 * Each test owns its slugs. The specs share one database, so a test reusing
 * another's natural keys would upsert its documents and pass for the wrong
 * reason, or fail depending on the order.
 */
const pagesSeed = (prefix: string, title = "Home") =>
	defineDummySeed({
		id: "pages",
		run: async (ctx) => {
			await ctx.doc("pages", { slug: `/${prefix}`, title });
			await ctx.doc("pages", { slug: `/${prefix}/about`, title: "About" });
		},
	});

describe("runDummySeeds", () => {
	it("creates a document per natural key on a first run", async () => {
		const result = await runDummySeeds({
			payload,
			seeds: [pagesSeed("first")],
		});

		expect(result.writes.get("pages")).toMatchObject({
			created: 2,
			updated: 0,
		});
	});

	it("updates rather than creating on a second run", async () => {
		await runDummySeeds({ payload, seeds: [pagesSeed("second")] });

		const result = await runDummySeeds({
			payload,
			seeds: [pagesSeed("second")],
		});

		expect(result.writes.get("pages")).toMatchObject({
			created: 0,
			updated: 2,
		});
	});

	it("leaves the same documents, with the same ids, as the first run", async () => {
		await runDummySeeds({ payload, seeds: [pagesSeed("same")] });

		const before = await storedState(payload, { collections: ["pages"] });

		await runDummySeeds({ payload, seeds: [pagesSeed("same")] });

		expect(await storedState(payload, { collections: ["pages"] })).toEqual(
			before,
		);
	});

	it("writes a changed non-key field on a re-run", async () => {
		await runDummySeeds({ payload, seeds: [pagesSeed("changed", "Before")] });
		await runDummySeeds({ payload, seeds: [pagesSeed("changed", "After")] });

		const found = await payload.find({
			collection: "pages",
			where: { slug: { equals: "/changed" } },
			overrideAccess: true,
		});

		expect(found.docs[0]?.["title"]).toBe("After");
	});

	it("reports the seeds it ran, in order", async () => {
		const result = await runDummySeeds({
			payload,
			seeds: [pagesSeed("reported")],
		});

		expect(result.seeds).toEqual(["pages"]);
	});

	it("refuses a document with no natural key value", async () => {
		await expect(
			runDummySeeds({
				payload,
				seeds: [
					defineDummySeed({
						id: "bad",
						run: async (ctx) => {
							await ctx.doc("pages", { title: "No slug" });
						},
					}),
				],
			}),
		).rejects.toThrow(/has no "slug", which is its natural key/);
	});

	it("refuses a ref in the natural key field", async () => {
		await expect(
			runDummySeeds({
				payload,
				seeds: [
					defineDummySeed({
						id: "bad",
						run: async (ctx) => {
							await ctx.doc("pages", {
								slug: ctx.ref("pages", "/"),
								title: "x",
							});
						},
					}),
				],
			}),
		).rejects.toThrow(/natural key "slug" carries a ref/);
	});

	it("leaves an existing document alone with keepIfExists", async () => {
		const seed = (title: string) =>
			defineDummySeed({
				id: "pages",
				run: async (ctx) => {
					await ctx.doc(
						"pages",
						{ slug: "/kept", title },
						{ keepIfExists: true },
					);
				},
			});
		const { reporter, events } = recorder();

		await runDummySeeds({ payload, seeds: [seed("First")] });

		const result = await runDummySeeds({
			payload,
			seeds: [seed("Second")],
			reporter,
		});
		const found = await payload.find({
			collection: "pages",
			where: { slug: { equals: "/kept" } },
			overrideAccess: true,
		});

		expect(found.docs[0]?.["title"]).toBe("First");
		expect(result.writes.get("pages")).toMatchObject({
			created: 0,
			updated: 0,
			skipped: 1,
		});
		expect(events).toContainEqual(
			expect.objectContaining({ key: "/kept", action: "skipped" }),
		);
	});

	it("leaves a document alone once the keepIfSet field carries a value", async () => {
		const seed = defineDummySeed({
			id: "authors",
			run: async (ctx) => {
				await ctx.doc(
					"authors",
					{ name: "Claimed" },
					{ keepIfSet: "featuredBook" },
				);
			},
		});

		const first = await runDummySeeds({ payload, seeds: [seed] });
		const second = await runDummySeeds({ payload, seeds: [seed] });

		expect(first.writes.get("authors")).toMatchObject({ created: 1 });
		expect(second.writes.get("authors")).toMatchObject({ updated: 1 });

		const book = await payload.create({
			collection: "books",
			data: { title: "Claimed by an editor" },
			overrideAccess: true,
		});

		await payload.update({
			collection: "authors",
			where: { name: { equals: "Claimed" } },
			data: { featuredBook: book.id },
			overrideAccess: true,
		});

		const third = await runDummySeeds({ payload, seeds: [seed] });

		expect(third.writes.get("authors")).toMatchObject({
			updated: 0,
			skipped: 1,
		});
	});

	it("completes a document created with keepIfExists on the replay", async () => {
		const seeds = [
			defineDummySeed({
				id: "authors",
				run: async (ctx) => {
					await ctx.doc(
						"authors",
						{ name: "Placeholder", featuredBook: ctx.ref("books", "Draft") },
						{ keepIfExists: true },
					);
				},
			}),
			defineDummySeed({
				id: "books",
				dependsOn: ["authors"],
				run: async (ctx) => {
					await ctx.doc("books", { title: "Draft" });
				},
			}),
		];

		const result = await runDummySeeds({ payload, seeds });
		const authors = await payload.find({
			collection: "authors",
			where: { name: { equals: "Placeholder" } },
			depth: 0,
			overrideAccess: true,
		});
		const books = await payload.find({
			collection: "books",
			where: { title: { equals: "Draft" } },
			depth: 0,
			overrideAccess: true,
		});

		expect(result.replayed).toBe(1);
		expect(authors.docs[0]?.["featuredBook"]).toBe(books.docs[0]?.id);

		const rerun = await runDummySeeds({ payload, seeds });

		expect(rerun.replayed).toBe(0);
		expect(rerun.writes.get("authors")).toMatchObject({ skipped: 1 });
	});
});
