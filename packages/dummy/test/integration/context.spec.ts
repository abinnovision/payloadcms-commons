import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootPayload } from "./helpers/payload.js";
import { isDummyWrite } from "../../src/context.js";
import { defineDummySeed } from "../../src/define-seed.js";
import { runDummySeeds } from "../../src/run.js";

import type { CollectionConfig, Payload } from "payload";

const seen: boolean[] = [];

/* Records what a hook with side effects would check before running them. */
const hooked: CollectionConfig = {
	slug: "hooked",
	fields: [
		{ name: "slug", type: "text", required: true, unique: true, index: true },
	],
	hooks: {
		afterChange: [
			({ doc, req, context }) => {
				seen.push(isDummyWrite(req) && isDummyWrite({ context }));

				return doc;
			},
		],
	},
};

let payload: Payload;

beforeAll(async () => {
	({ payload } = await bootPayload({ key: "context", collections: [hooked] }));
});

afterAll(async () => {
	await payload.destroy();
});

describe("isDummyWrite", () => {
	it("is true in a hook run by a seed write, and false otherwise", async () => {
		const seeds = [
			defineDummySeed({
				id: "hooked",
				run: async (ctx) => {
					await ctx.doc("hooked" as never, { slug: "a" });
				},
			}),
		];

		// The first run creates, the second updates.
		await runDummySeeds({ payload, seeds });
		await runDummySeeds({ payload, seeds });
		await payload.create({
			collection: "hooked" as never,
			data: { slug: "b" },
			overrideAccess: true,
		});

		expect(seen).toEqual([true, true, false]);
	});
});
