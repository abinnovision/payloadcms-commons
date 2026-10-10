import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootPayload } from "./helpers/payload.js";
import { defineDummySeed } from "../../src/define-seed.js";
import { runDummySeeds } from "../../src/run.js";

import type { Payload } from "payload";

let payload: Payload;

beforeAll(async () => {
	({ payload } = await bootPayload({ key: "localized" }));
});

afterAll(async () => {
	await payload.destroy();
});

const titleIn = async (slug: string, locale: "de" | "en"): Promise<unknown> => {
	const found = await payload.find({
		collection: "pages",
		where: { slug: { equals: slug } },
		locale,
		overrideAccess: true,
	});

	return found.docs[0]?.["title"];
};

describe("localized writes", () => {
	it("writes the default locale and the overrides, and keeps both on a re-run", async () => {
		const seeds = [
			defineDummySeed({
				id: "pages",
				run: async (ctx) => {
					await ctx.doc(
						"pages",
						{ slug: "/", title: "Home" },
						{ locales: { de: { title: "Startseite" } } },
					);
				},
			}),
		];

		await runDummySeeds({ payload, seeds });

		expect(await titleIn("/", "en")).toBe("Home");
		expect(await titleIn("/", "de")).toBe("Startseite");

		await runDummySeeds({ payload, seeds });

		expect(await titleIn("/", "en")).toBe("Home");
		expect(await titleIn("/", "de")).toBe("Startseite");
	});

	/*
	 * The case apps/example works around by hand: without the grafted row ids
	 * Payload treats the German write as a new row set and drops the English
	 * paths with it.
	 */
	it("keeps a localized array's other locale, by grafting the row ids", async () => {
		const seeds = [
			defineDummySeed({
				id: "routes",
				run: async (ctx) => {
					await ctx.global(
						"routes",
						{
							entries: [
								{ collectionName: "pages", path: "/*slug" },
								{ collectionName: "sections", path: "/topic/:slug" },
							],
						},
						{
							locales: {
								de: {
									entries: [
										{ collectionName: "pages", path: "/*slug" },
										{ collectionName: "sections", path: "/thema/:slug" },
									],
								},
							},
						},
					);
				},
			}),
		];

		await runDummySeeds({ payload, seeds });

		const read = async (locale: "de" | "en"): Promise<{ path?: string }[]> => {
			const found = (await payload.findGlobal({
				slug: "routes",
				locale,
				depth: 0,
				overrideAccess: true,
			})) as { entries?: { path?: string }[] };

			return found.entries ?? [];
		};

		expect((await read("en")).map((row) => row.path)).toEqual([
			"/*slug",
			"/topic/:slug",
		]);
		expect((await read("de")).map((row) => row.path)).toEqual([
			"/*slug",
			"/thema/:slug",
		]);

		// And a second run must not lose either side.
		await runDummySeeds({ payload, seeds });

		expect((await read("en")).map((row) => row.path)).toEqual([
			"/*slug",
			"/topic/:slug",
		]);
		expect((await read("de")).map((row) => row.path)).toEqual([
			"/*slug",
			"/thema/:slug",
		]);
	});

	it("keeps a localized array on a collection too", async () => {
		await runDummySeeds({
			payload,
			seeds: [
				defineDummySeed({
					id: "posts",
					run: async (ctx) => {
						await ctx.doc(
							"posts",
							{
								title: "Serial",
								chapters: [{ heading: "One" }, { heading: "Two" }],
							},
							{
								locales: {
									de: { chapters: [{ heading: "Eins" }, { heading: "Zwei" }] },
								},
							},
						);
					},
				}),
			],
		});

		const read = async (locale: "de" | "en"): Promise<unknown[]> => {
			const found = await payload.find({
				collection: "posts",
				where: { title: { equals: "Serial" } },
				locale,
				depth: 0,
				overrideAccess: true,
			});

			return (found.docs[0]?.["chapters"] as { heading?: string }[]).map(
				(row) => row.heading,
			);
		};

		expect(await read("en")).toEqual(["One", "Two"]);
		expect(await read("de")).toEqual(["Eins", "Zwei"]);
	});

	/*
	 * The rule only applies where the rows are shared. A localized array has its
	 * own rows per locale, so there is nothing to line up against on a first
	 * write, and this global is the shape where a mismatch really does lose data.
	 */
	it("refuses an override that does not line up with the shared rows", async () => {
		await expect(
			runDummySeeds({
				payload,
				seeds: [
					defineDummySeed({
						id: "routes",
						run: async (ctx) => {
							await ctx.global(
								"routes",
								{
									entries: [
										{ collectionName: "pages", path: "/a" },
										{ collectionName: "posts", path: "/b" },
									],
								},
								{
									locales: {
										de: { entries: [{ collectionName: "pages", path: "/a" }] },
									},
								},
							);
						},
					}),
				],
			}),
		).rejects.toThrow(
			/locale "de" has 1 rows at "entries" where the default locale has 2/,
		);
	});

	it("keeps each locale's own rows for an array that is itself localized", async () => {
		const seeds = [
			defineDummySeed({
				id: "menus",
				run: async (ctx) => {
					await ctx.global(
						"menus",
						{ items: [{ label: "Home" }] },
						{
							locales: {
								de: { items: [{ label: "Start" }, { label: "Mehr" }] },
							},
						},
					);
				},
			}),
		];

		await runDummySeeds({ payload, seeds });

		const read = async (locale: "de" | "en"): Promise<unknown[]> => {
			const found = (await payload.findGlobal({
				slug: "menus",
				locale,
				depth: 0,
				overrideAccess: true,
			})) as { items?: { label?: string }[] };

			return (found.items ?? []).map((row) => row.label);
		};

		// Different lengths per locale are fine here: the rows are not shared.
		expect(await read("en")).toEqual(["Home"]);
		expect(await read("de")).toEqual(["Start", "Mehr"]);

		await runDummySeeds({ payload, seeds });

		expect(await read("en")).toEqual(["Home"]);
		expect(await read("de")).toEqual(["Start", "Mehr"]);
	});

	it("resolves a ref inside a locale override", async () => {
		await runDummySeeds({
			payload,
			seeds: [
				defineDummySeed({
					id: "tags",
					run: async (ctx) => {
						await ctx.doc("tags", { name: "Localized" });
					},
				}),
				defineDummySeed({
					id: "posts",
					dependsOn: ["tags"],
					run: async (ctx) => {
						await ctx.doc(
							"posts",
							{ title: "Tagged" },
							{ locales: { de: { tags: [ctx.ref("tags", "Localized")] } } },
						);
					},
				}),
			],
		});

		const tag = await payload.find({
			collection: "tags",
			where: { name: { equals: "Localized" } },
			overrideAccess: true,
		});
		const post = await payload.find({
			collection: "posts",
			where: { title: { equals: "Tagged" } },
			locale: "de",
			depth: 0,
			overrideAccess: true,
		});

		expect(post.docs[0]?.["tags"]).toEqual([tag.docs[0]?.id]);
	});
});
