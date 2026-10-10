import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootPayload, recorder } from "./helpers/payload.js";
import { defineDummySeed } from "../../src/define-seed.js";
import { runDummySeeds } from "../../src/run.js";

import type { Payload } from "payload";

let payload: Payload;

beforeAll(async () => {
	({ payload } = await bootPayload({ key: "replay" }));
});

afterAll(async () => {
	await payload.destroy();
});

/*
 * authors and books reference each other, which dependsOn cannot express. The
 * pair is parameterised so each test owns its documents: sharing them would let
 * an earlier test's rows resolve the refs from the database, which is correct
 * behaviour but not what these tests are checking.
 */
const mutualPair = (
	author: string,
	book: string,
): readonly [
	ReturnType<typeof defineDummySeed>,
	ReturnType<typeof defineDummySeed>,
] => [
	defineDummySeed({
		id: "authors",
		run: async (ctx) => {
			await ctx.doc("authors", {
				name: author,
				featuredBook: ctx.ref("books", book),
			});
		},
	}),
	defineDummySeed({
		id: "books",
		dependsOn: ["authors"],
		run: async (ctx) => {
			await ctx.doc("books", {
				title: book,
				author: ctx.ref("authors", author),
			});
		},
	}),
];

describe("the replay pass", () => {
	it("links two mutually referencing collections, both ways", async () => {
		const result = await runDummySeeds({
			payload,
			seeds: [...mutualPair("Ada", "Notes")],
		});
		const authors = await payload.find({
			collection: "authors",
			where: { name: { equals: "Ada" } },
			depth: 0,
			overrideAccess: true,
		});
		const books = await payload.find({
			collection: "books",
			where: { title: { equals: "Notes" } },
			depth: 0,
			overrideAccess: true,
		});

		expect(result.replayed).toBe(1);
		expect(authors.docs[0]?.["featuredBook"]).toBe(books.docs[0]?.id);
		expect(books.docs[0]?.["author"]).toBe(authors.docs[0]?.id);
	});

	it("reports the first write as deferred", async () => {
		const { reporter, events } = recorder();

		await runDummySeeds({
			payload,
			seeds: [...mutualPair("Grace", "Logs")],
			reporter,
		});

		expect(events).toContainEqual(
			expect.objectContaining({ slug: "authors", action: "deferred" }),
		);
	});

	it("needs no replay when every ref points backwards", async () => {
		const result = await runDummySeeds({
			payload,
			seeds: [
				defineDummySeed({
					id: "tags",
					run: async (ctx) => {
						await ctx.doc("tags", { name: "Release notes" });
					},
				}),
				defineDummySeed({
					id: "posts",
					dependsOn: ["tags"],
					run: async (ctx) => {
						await ctx.doc("posts", {
							title: "First",
							tags: [ctx.ref("tags", "Release notes")],
						});
					},
				}),
			],
		});

		expect(result.replayed).toBe(0);
	});

	it("resolves a forward ref nested inside a blocks field", async () => {
		await runDummySeeds({
			payload,
			seeds: [
				defineDummySeed({
					id: "home",
					run: async (ctx) => {
						await ctx.doc("pages", {
							slug: "/home",
							title: "Home",
							layout: [
								{ blockType: "callout", tone: "info", body: "kept" },
								{
									blockType: "card",
									heading: "Later",
									link: ctx.ref("pages", "/late"),
								},
							],
						});
					},
				}),
				defineDummySeed({
					id: "late",
					dependsOn: ["home"],
					run: async (ctx) => {
						await ctx.doc("pages", { slug: "/late", title: "Late" });
					},
				}),
			],
		});

		const home = await payload.find({
			collection: "pages",
			where: { slug: { equals: "/home" } },
			depth: 0,
			overrideAccess: true,
		});
		const late = await payload.find({
			collection: "pages",
			where: { slug: { equals: "/late" } },
			depth: 0,
			overrideAccess: true,
		});
		const layout = home.docs[0]?.["layout"] as {
			blockType: string;
			link?: string;
		}[];

		expect(layout).toHaveLength(2);
		expect(layout[1]?.link).toBe(late.docs[0]?.id);
	});

	it("names a ref that can never resolve, and the keys that do exist", async () => {
		await expect(
			runDummySeeds({
				payload,
				seeds: [
					defineDummySeed({
						id: "authors",
						run: async (ctx) => {
							await ctx.doc("authors", { name: "Aerin" });
							await ctx.doc("authors", {
								name: "Zoe",
								featuredBook: ctx.ref("authors", "Adda"),
							});
						},
					}),
				],
			}),
		).rejects.toThrow(
			/refs never resolved[\s\S]*authors:"Adda"[\s\S]*has: Zoe|Aerin/,
		);
	});

	it("says no seed wrote to the collection when none did", async () => {
		await expect(
			runDummySeeds({
				payload,
				seeds: [
					defineDummySeed({
						id: "posts",
						run: async (ctx) => {
							await ctx.doc("posts", {
								title: "Orphan",
								hero: ctx.ref("media", "nope.png"),
							});
						},
					}),
				],
			}),
		).rejects.toThrow(/no seed wrote to "media"/);
	});
});
