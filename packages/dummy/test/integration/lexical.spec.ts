import { BlocksFeature, lexicalEditor } from "@payloadcms/richtext-lexical";
import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
	bootPayload,
	cleanScratch,
	writePixelFile,
} from "./helpers/payload.js";
import { defineDummySeed } from "../../src/define-seed.js";
import * as rt from "../../src/lexical/index.js";
import { runDummySeeds } from "../../src/run.js";
import { ctaBlock } from "../fixtures/blocks.js";
import { MEDIA_DIR } from "../fixtures/collections.js";

import type { CollectionConfig, Payload } from "payload";

/** A rich text field whose editor also accepts the `cta` block. */
const articles: CollectionConfig = {
	slug: "articles",
	fields: [
		{ name: "slug", type: "text", required: true, unique: true, index: true },
		{
			name: "content",
			type: "richText",
			editor: lexicalEditor({
				features: ({ defaultFeatures }) => [
					...defaultFeatures,
					BlocksFeature({ blocks: [ctaBlock] }),
				],
			}),
		},
	],
};

let payload: Payload;

beforeAll(async () => {
	({ payload } = await bootPayload({
		key: "lexical",
		collections: [articles],
	}));
});

afterAll(async () => {
	cleanScratch();
	rmSync(MEDIA_DIR, { recursive: true, force: true });
	await payload.destroy();
});

describe("lexical builders", () => {
	it("store a state built with every builder, with every ref resolved", async () => {
		const file = writePixelFile("lexical.png");

		await runDummySeeds({
			payload,
			seeds: [
				defineDummySeed({
					id: "articles",
					run: async (ctx) => {
						await ctx.upload("media", file, { alt: "Pixel" });
						await ctx.doc("pages", { slug: "/target", title: "Target" });
						await ctx.doc("articles", {
							slug: "intro",
							content: rt.richText(
								rt.h("h2", "Getting started"),
								"Plain paragraph.",
								rt.p(
									"Read ",
									rt.link(ctx.ref("pages", "/target"), "this"),
									" or ",
									rt.text("skip it", "bold"),
								),
								rt.list("bullet", "First", [
									"Second ",
									rt.link("https://example.com", "link"),
								]),
								rt.upload(ctx.ref("media", "lexical.png")),
								rt.block("cta", {
									label: "Go",
									page: ctx.ref("pages", "/target"),
								}),
							),
						});
					},
				}),
			],
		});

		const [page, media, article] = await Promise.all(
			[
				{ collection: "pages", field: "slug", value: "/target" },
				{ collection: "media", field: "filename", value: "lexical.png" },
				{ collection: "articles", field: "slug", value: "intro" },
			].map(async (query) => {
				const found = await payload.find({
					collection: query.collection as never,
					where: { [query.field]: { equals: query.value } },
					depth: 0,
					overrideAccess: true,
				});

				return found.docs[0] as Record<string, unknown>;
			}),
		);
		const children = (
			article?.["content"] as { root: { children: Record<string, any>[] } }
		).root.children;

		expect(children.map((node) => node["type"])).toEqual([
			"heading",
			"paragraph",
			"paragraph",
			"list",
			"upload",
			"block",
		]);
		expect(children[2]?.["children"][1]["fields"]["doc"]).toEqual({
			relationTo: "pages",
			value: page?.["id"],
		});
		expect(children[4]?.["value"]).toBe(media?.["id"]);
		expect(children[5]?.["fields"]).toMatchObject({
			blockType: "cta",
			label: "Go",
			page: page?.["id"],
			id: expect.any(String),
		});
	});
});
