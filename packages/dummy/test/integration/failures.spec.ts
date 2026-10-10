import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootPayload } from "./helpers/payload.js";
import { defineDummySeed } from "../../src/define-seed.js";
import { runDummySeeds } from "../../src/run.js";

import type { Payload } from "payload";

let payload: Payload;

beforeAll(async () => {
	({ payload } = await bootPayload({ key: "failures" }));
});

afterAll(async () => {
	await payload.destroy();
});

describe("a failing run", () => {
	it("stops at the first failure and writes nothing from later seeds", async () => {
		await expect(
			runDummySeeds({
				payload,
				seeds: [
					defineDummySeed({
						id: "first",
						run: async (ctx) => {
							await ctx.doc("tags", { name: "Before" });
						},
					}),
					defineDummySeed({
						id: "boom",
						dependsOn: ["first"],
						run: () => Promise.reject(new Error("seed exploded")),
					}),
					defineDummySeed({
						id: "later",
						dependsOn: ["boom"],
						run: async (ctx) => {
							await ctx.doc("tags", { name: "After" });
						},
					}),
				],
			}),
		).rejects.toThrow("seed exploded");

		const found = await payload.find({
			collection: "tags",
			limit: 0,
			pagination: false,
			overrideAccess: true,
		});

		expect(found.docs.map((doc) => doc["name"])).toEqual(["Before"]);
	});

	it("names the document when Payload refuses it", async () => {
		await expect(
			runDummySeeds({
				payload,
				seeds: [
					defineDummySeed({
						id: "pages",
						run: async (ctx) => {
							// `title` is required, so Payload refuses this.
							await ctx.doc("pages", { slug: "/broken" });
						},
					}),
				],
			}),
		).rejects.toThrow(/pages "\/broken": validation failed/);
	});

	it("keeps the Payload error as the cause", async () => {
		const thrown = await runDummySeeds({
			payload,
			seeds: [
				defineDummySeed({
					id: "pages",
					run: async (ctx) => {
						await ctx.doc("pages", { slug: "/broken" });
					},
				}),
			],
		}).catch((error: unknown) => error);

		expect(thrown).toBeInstanceOf(Error);
		expect((thrown as Error).cause).toBeInstanceOf(Error);
	});

	it("explains a required field whose ref points forward", async () => {
		await expect(
			runDummySeeds({
				payload,
				seeds: [
					defineDummySeed({
						id: "pages",
						run: async (ctx) => {
							await ctx.doc("pages", {
								slug: "/needs-title",
								title: ctx.ref("tags", "Later") as never,
							});
						},
					}),
					defineDummySeed({
						id: "tags",
						dependsOn: ["pages"],
						run: async (ctx) => {
							await ctx.doc("tags", { name: "Later" });
						},
					}),
				],
			}),
		).rejects.toThrow(/is not written yet.*dependsOn: \["tags"\]/s);
	});
});
