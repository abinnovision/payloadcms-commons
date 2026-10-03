import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMcpClient } from "./helpers/mcp.js";
import {
	bootPayload,
	createDraft,
	readDraft,
	seedKeys,
} from "./helpers/payload.js";
import { hero, section } from "../builders/blocks.js";

import type { McpClient } from "./helpers/mcp.js";
import type { Booted } from "./helpers/payload.js";

interface PageDoc {
	id: number | string;
	title?: string | null;
	layout?: { color?: string | null; sections?: Record<string, unknown>[] };
}

interface PostDoc {
	id: number | string;
	items?: {
		id?: string;
		heading?: string | null;
		actions?: { id?: string; label?: string }[];
	}[];
}

describe("patchDocument on fields and blocks", () => {
	let booted: Booted;
	let mcp: McpClient;

	beforeAll(async () => {
		booted = await bootPayload();
		mcp = createMcpClient(booted, (await seedKeys(booted.payload)).keys.full);
	});

	afterAll(async () => {
		await booted.payload.destroy();
	});

	const createPage = (data: Record<string, unknown>) =>
		createDraft<PageDoc>(booted.payload, "pages", data);

	const readPage = (id: number | string, locale = "en") =>
		readDraft<PageDoc>(booted.payload, "pages", id, locale);

	const createPost = (data: Record<string, unknown>) =>
		createDraft<PostDoc>(booted.payload, "posts", data);

	const readPost = (id: number | string, locale = "en") =>
		readDraft<PostDoc>(booted.payload, "posts", id, locale);

	it("announces itself as destructive, because it removes and replaces", async () => {
		const tool = (await mcp.list()).find(
			(candidate) => candidate.name === "patchDocument",
		);

		expect(tool?.annotations).toMatchObject({ destructiveHint: true });
	});

	it("writes a draft and reports what still blocks publishing", async () => {
		const page = await createPage({ title: "Draft", slug: "draft" });
		const result = await mcp.call("patchDocument", {
			collection: "pages",
			id: page.id,
			locale: "en",
			patches: [{ op: "replace", path: "/title", value: "Renamed" }],
		});

		expect(result.isError).toBe(false);
		expect(result.data["status"]).toBe("draft");
		expect(result.data["publishBlockers"]).toEqual([
			expect.objectContaining({ path: "/layout/sections" }),
		]);
		expect((await readPage(page.id)).title).toBe("Renamed");
	});

	it("appends a block with /- and a blockType", async () => {
		const page = await createPage({ title: "Blocks", slug: "blocks" });
		const result = await mcp.call("patchDocument", {
			collection: "pages",
			id: page.id,
			locale: "en",
			patches: [
				{
					op: "add",
					path: "/layout/sections/-",
					value: section("intro", [hero("Hello")]),
				},
			],
		});

		expect(result.isError).toBe(false);
		expect(result.data).not.toHaveProperty("publishBlockers");

		const saved = await readPage(page.id);
		const [first] = saved.layout?.sections ?? [];

		expect(first?.["blockType"]).toBe("sectionWrapper");
		expect(first?.["identifier"]).toBe("intro");
		expect((first?.["modules"] as { blockType: string }[])[0]?.blockType).toBe(
			"hero",
		);
	});

	it("does not flag a whole blocks field as notApplied", async () => {
		const page = await createPage({
			title: "Whole field",
			slug: "whole-field",
			layout: { sections: [section("old")] },
		});
		const result = await mcp.call("patchDocument", {
			collection: "pages",
			id: page.id,
			locale: "en",
			patches: [
				{
					op: "replace",
					path: "/layout/sections",
					value: [section("fresh", [hero("Hi")])],
				},
			],
		});

		expect(result.isError).toBe(false);
		expect(result.data).not.toHaveProperty("notApplied");

		const [first] = (await readPage(page.id)).layout?.sections ?? [];

		expect(first?.["identifier"]).toBe("fresh");
	});

	it("applies nothing when one operation in the batch is invalid", async () => {
		const page = await createPage({ title: "Atomic", slug: "atomic" });
		const result = await mcp.call("patchDocument", {
			collection: "pages",
			id: page.id,
			locale: "en",
			patches: [
				{ op: "replace", path: "/title", value: "Changed" },
				{ op: "replace", path: "/titel", value: "typo" },
			],
		});

		expect(result.isError).toBe(true);
		expect(result.data["problems"]).toEqual([expect.stringContaining("titel")]);
		expect((await readPage(page.id)).title).toBe("Atomic");
	});

	it("refuses a blockType that is not a string as the operation's problem", async () => {
		const page = await createPage({ title: "Odd slug", slug: "odd-slug" });
		const before = await readPage(page.id);
		const result = await mcp.call("patchDocument", {
			collection: "pages",
			id: page.id,
			locale: "en",
			patches: [
				{
					op: "add",
					path: "/layout/sections/-",
					value: { blockType: { toString: 1 } },
				},
			],
		});

		expect(result.isError).toBe(true);
		expect(result.data["error"]).toBe("No operation was applied.");
		expect(result.data["problems"]).toEqual([
			'patches[0]: "blockType" must be a string naming a block at "/layout/sections". Allowed: sectionWrapper, richText',
		]);
		expect(await readPage(page.id)).toEqual(before);
	});

	it("refuses remove on a field but allows it on a list element", async () => {
		const page = await createPage({
			title: "Remove",
			slug: "remove",
			layout: { color: "dark", sections: [section("a"), section("b")] },
		});

		const onField = await mcp.call("patchDocument", {
			collection: "pages",
			id: page.id,
			locale: "en",
			patches: [{ op: "remove", path: "/layout/color" }],
		});
		const onElement = await mcp.call("patchDocument", {
			collection: "pages",
			id: page.id,
			locale: "en",
			patches: [{ op: "remove", path: "/layout/sections/0" }],
		});

		expect(onField.isError).toBe(true);
		expect(JSON.stringify(onField.data["problems"])).toContain("replace");
		expect(onElement.isError).toBe(false);

		const saved = await readPage(page.id);

		expect(saved.layout?.color).toBe("dark");
		expect(saved.layout?.sections?.map((s) => s["identifier"])).toEqual(["b"]);
	});

	it("writes one locale without touching or copying the other", async () => {
		const page = await createPage({ title: "Home", slug: "home" });

		const titleInDe = await mcp.call("patchDocument", {
			collection: "pages",
			id: page.id,
			locale: "de",
			patches: [{ op: "replace", path: "/title", value: "Startseite" }],
		});
		const colorInDe = await mcp.call("patchDocument", {
			collection: "pages",
			id: page.id,
			locale: "de",
			patches: [{ op: "replace", path: "/layout/color", value: "dark" }],
		});

		expect(titleInDe.isError).toBe(false);
		expect(colorInDe.isError).toBe(false);
		expect((await readPage(page.id, "en")).title).toBe("Home");
		expect((await readPage(page.id, "de")).title).toBe("Startseite");

		const other = await createPage({ title: "Only english", slug: "only-en" });

		await mcp.call("patchDocument", {
			collection: "pages",
			id: other.id,
			locale: "de",
			patches: [{ op: "replace", path: "/layout/color", value: "light" }],
		});

		const de = await readPage(other.id, "de");

		expect(de.layout?.color).toBe("light");
		expect(de.title ?? null).toBeNull();
		expect((await readPage(other.id, "en")).title).toBe("Only english");
	});

	it("patches a scalar inside a block nested under an array field", async () => {
		const post = await createPost({
			title: "Post",
			items: [
				{ heading: "One", actions: [{ blockType: "cta", label: "Old" }] },
			],
		});
		const result = await mcp.call("patchDocument", {
			collection: "posts",
			id: post.id,
			locale: "en",
			patches: [
				{ op: "replace", path: "/items/0/actions/0/label", value: "New" },
			],
		});

		expect(result.isError).toBe(false);
		expect(result.data).not.toHaveProperty("notApplied");

		const saved = await readPost(post.id);

		expect(saved.items?.[0]?.actions?.[0]?.label).toBe("New");
	});

	it("keeps row identity on a whole-field replace, so other locales survive", async () => {
		const post = await createPost({
			title: "Post",
			items: [{ heading: "English", actions: [] }],
		});

		const inDe = await mcp.call("patchDocument", {
			collection: "posts",
			id: post.id,
			locale: "de",
			patches: [{ op: "replace", path: "/items/0/heading", value: "Deutsch" }],
		});

		expect(inDe.isError).toBe(false);

		const before = await readPost(post.id);
		const row = before.items?.[0];
		const inEn = await mcp.call("patchDocument", {
			collection: "posts",
			id: post.id,
			locale: "en",
			patches: [
				{
					op: "replace",
					path: "/items",
					value: [{ ...row, heading: "English, edited" }],
				},
			],
		});

		expect(inEn.isError).toBe(false);

		const en = await readPost(post.id);

		expect(en.items?.[0]?.heading).toBe("English, edited");
		expect(en.items?.[0]?.id).toBe(row?.id);
		expect((await readPost(post.id, "de")).items?.[0]?.heading).toBe("Deutsch");
	});
});
