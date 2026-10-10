import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootPayload } from "./helpers/payload.js";
import { defineDummySeed } from "../../src/define-seed.js";
import { runDummySeeds } from "../../src/run.js";

import type { Payload } from "payload";

let payload: Payload;

beforeAll(async () => {
	({ payload } = await bootPayload({ key: "globals" }));
});

afterAll(async () => {
	await payload.destroy();
});

describe("globals", () => {
	it("writes a global and publishes it where it has drafts", async () => {
		await runDummySeeds({
			payload,
			seeds: [
				defineDummySeed({
					id: "settings",
					run: async (ctx) => {
						await ctx.global("site-settings", {
							title: "Example",
							tagline: "A site",
						});
					},
				}),
			],
		});

		const found = (await payload.findGlobal({
			slug: "site-settings",
			overrideAccess: true,
		})) as Record<string, unknown>;

		expect(found["title"]).toBe("Example");
		expect(found["_status"]).toBe("published");
	});

	it("writes a global without versions live, and adds no status", async () => {
		await runDummySeeds({
			payload,
			seeds: [
				defineDummySeed({
					id: "banner",
					run: async (ctx) => {
						await ctx.global("banner", { message: "Hello" });
					},
				}),
			],
		});

		const found = (await payload.findGlobal({
			slug: "banner",
			overrideAccess: true,
		})) as Record<string, unknown>;

		expect(found["message"]).toBe("Hello");
		expect(found["_status"]).toBeUndefined();
	});

	it("is idempotent", async () => {
		const seeds = [
			defineDummySeed({
				id: "banner",
				run: async (ctx) => {
					await ctx.global("banner", { message: "Steady" });
				},
			}),
		];

		await runDummySeeds({ payload, seeds });

		const result = await runDummySeeds({ payload, seeds });
		const found = (await payload.findGlobal({
			slug: "banner",
			overrideAccess: true,
		})) as Record<string, unknown>;

		expect(found["message"]).toBe("Steady");
		expect(result.writes.get("banner")).toMatchObject({ updated: 1 });
	});

	it("leaves an editor-authored field alone when keepIfSet names it", async () => {
		const write = (message: string, keep: boolean) =>
			runDummySeeds({
				payload,
				seeds: [
					defineDummySeed({
						id: "banner",
						run: async (ctx) => {
							await ctx.global(
								"banner",
								{ message },
								keep ? { keepIfSet: "message" } : {},
							);
						},
					}),
				],
			});

		await write("Written by an editor", false);

		const result = await write("Seeded over the top", true);
		const found = (await payload.findGlobal({
			slug: "banner",
			overrideAccess: true,
		})) as Record<string, unknown>;

		expect(found["message"]).toBe("Written by an editor");
		expect(result.writes.get("banner")).toMatchObject({ skipped: 1 });
	});

	it("writes when keepIfSet names a field that is still empty", async () => {
		/*
		 * Clears the guard first. Another test in this file sets `homepage`, and
		 * the specs share a database, so the precondition has to be established
		 * rather than assumed.
		 */
		await runDummySeeds({
			payload,
			seeds: [
				defineDummySeed({
					id: "settings",
					run: async (ctx) => {
						await ctx.global("site-settings", {
							title: "Before",
							homepage: null,
						});
					},
				}),
			],
		});

		await runDummySeeds({
			payload,
			seeds: [
				defineDummySeed({
					id: "settings",
					run: async (ctx) => {
						await ctx.global(
							"site-settings",
							{ title: "Written because the guard is empty" },
							{ keepIfSet: "homepage" },
						);
					},
				}),
			],
		});

		const found = (await payload.findGlobal({
			slug: "site-settings",
			overrideAccess: true,
		})) as Record<string, unknown>;

		expect(found["title"]).toBe("Written because the guard is empty");
	});

	it("resolves a ref inside a global", async () => {
		await runDummySeeds({
			payload,
			seeds: [
				defineDummySeed({
					id: "pages",
					run: async (ctx) => {
						await ctx.doc("pages", { slug: "/", title: "Home" });
					},
				}),
				defineDummySeed({
					id: "settings",
					dependsOn: ["pages"],
					run: async (ctx) => {
						await ctx.global("site-settings", {
							title: "Example",
							homepage: ctx.ref("pages", "/"),
						});
					},
				}),
			],
		});

		const home = await payload.find({
			collection: "pages",
			where: { slug: { equals: "/" } },
			depth: 0,
			overrideAccess: true,
		});
		const found = (await payload.findGlobal({
			slug: "site-settings",
			depth: 0,
			overrideAccess: true,
		})) as Record<string, unknown>;

		expect(found["homepage"]).toBe(home.docs[0]?.id);
	});
});
