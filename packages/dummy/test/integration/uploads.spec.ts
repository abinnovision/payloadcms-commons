import { rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { defineDummySeed } from "../../src/define-seed.js";
import { runDummySeeds } from "../../src/run.js";
import { MEDIA_DIR } from "../fixtures/collections.js";
import {
	bootPayload,
	cleanScratch,
	writePixelFile,
} from "./helpers/payload.js";

import type { Payload } from "payload";

let payload: Payload;

beforeAll(async () => {
	({ payload } = await bootPayload({ key: "uploads" }));
});

afterAll(async () => {
	cleanScratch();
	rmSync(MEDIA_DIR, { recursive: true, force: true });
	await payload.destroy();
});

const uploadSeed = (filePath: string, alt: string) =>
	defineDummySeed({
		id: "media",
		run: async (ctx) => {
			await ctx.upload("media", filePath, { alt });
		},
	});

describe("uploads", () => {
	it("stores the file, with its real size and type", async () => {
		const file = writePixelFile("hero.png");
		const warned = vi.fn();

		await runDummySeeds({
			payload,
			seeds: [uploadSeed(file, "Hero")],
			reporter: { warned },
		});

		const found = await payload.find({
			collection: "media",
			where: { filename: { contains: "hero" } },
			overrideAccess: true,
		});

		expect(found.docs[0]?.["mimeType"]).toBe("image/png");
		expect(found.docs[0]?.["filesize"]).toBeGreaterThan(0);
		expect(found.docs[0]?.["alt"]).toBe("Hero");
		expect(warned).not.toHaveBeenCalled();
	});

	it("reuses the same document on a re-run, deduped on the basename", async () => {
		await runDummySeeds({
			payload,
			seeds: [uploadSeed(writePixelFile("dedup.png"), "First")],
		});

		const result = await runDummySeeds({
			payload,
			seeds: [uploadSeed(writePixelFile("dedup.png"), "Second")],
		});
		const found = await payload.find({
			collection: "media",
			where: { filename: { contains: "dedup" } },
			overrideAccess: true,
		});

		expect(found.docs).toHaveLength(1);
		expect(result.writes.get("media")).toMatchObject({
			created: 0,
			updated: 1,
		});
	});

	it("updates the metadata and leaves the stored file alone", async () => {
		await runDummySeeds({
			payload,
			seeds: [uploadSeed(writePixelFile("meta.png"), "First")],
		});

		const before = await payload.find({
			collection: "media",
			where: { filename: { contains: "meta" } },
			overrideAccess: true,
		});

		await runDummySeeds({
			payload,
			seeds: [uploadSeed(writePixelFile("meta.png"), "Second")],
		});

		const after = await payload.find({
			collection: "media",
			where: { filename: { contains: "meta" } },
			overrideAccess: true,
		});

		expect(after.docs[0]?.["alt"]).toBe("Second");
		expect(after.docs[0]?.["filename"]).toBe(before.docs[0]?.["filename"]);
		expect(after.docs[0]?.["filesize"]).toBe(before.docs[0]?.["filesize"]);
	});

	it("is addressable by its basename, so a ref resolves to it", async () => {
		await runDummySeeds({
			payload,
			seeds: [
				uploadSeed(writePixelFile("cover.png"), "Cover"),
				defineDummySeed({
					id: "posts",
					dependsOn: ["media"],
					run: async (ctx) => {
						await ctx.doc("posts", {
							title: "Illustrated",
							hero: ctx.ref("media", "cover.png"),
						});
					},
				}),
			],
		});

		const cover = await payload.find({
			collection: "media",
			where: { filename: { contains: "cover" } },
			overrideAccess: true,
		});
		const post = await payload.find({
			collection: "posts",
			where: { title: { equals: "Illustrated" } },
			depth: 0,
			overrideAccess: true,
		});

		expect(post.docs[0]?.["hero"]).toBe(cover.docs[0]?.id);
	});

	it("resolves a ref to an upload an earlier run wrote", async () => {
		await runDummySeeds({
			payload,
			seeds: [uploadSeed(writePixelFile("banner.png"), "Banner")],
		});
		await runDummySeeds({
			payload,
			seeds: [
				defineDummySeed({
					id: "posts",
					run: async (ctx) => {
						await ctx.doc("posts", {
							title: "Bannered",
							hero: ctx.ref("media", "banner.png"),
						});
					},
				}),
			],
		});

		const banner = await payload.find({
			collection: "media",
			where: { filename: { contains: "banner" } },
			overrideAccess: true,
		});
		const post = await payload.find({
			collection: "posts",
			where: { title: { equals: "Bannered" } },
			depth: 0,
			overrideAccess: true,
		});

		expect(post.docs[0]?.["hero"]).toBe(banner.docs[0]?.id);
	});

	it("refuses a collection that takes no file", async () => {
		await expect(
			runDummySeeds({
				payload,
				seeds: [
					defineDummySeed({
						id: "bad",
						run: async (ctx) => {
							await ctx.upload("pages", writePixelFile());
						},
					}),
				],
			}),
		).rejects.toThrow(/has no upload config.*Use doc\(\) instead/s);
	});
});
