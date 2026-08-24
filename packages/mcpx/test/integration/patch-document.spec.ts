import { createLocalReq } from "payload";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { callTool } from "./helpers/mcp.js";
import { bootPayload, hero, section, seedKeys } from "./helpers/payload.js";

import type { Booted, Seeded } from "./helpers/payload.js";
import type { TypedUser } from "payload";

interface PageDoc {
	id: number | string;
	title?: string | null;
	_status?: string;
	updatedAt: string;
	layout?: { color?: string | null; sections?: Record<string, unknown>[] };
}

describe("patchDocument", () => {
	let booted: Booted;
	let seeded: Seeded;

	beforeAll(async () => {
		booted = await bootPayload();
		seeded = await seedKeys(booted.payload);
	});

	afterAll(async () => {
		await booted.payload.destroy();
	});

	const patch = (args: Record<string, unknown>) =>
		callTool(booted.config, seeded.keys.full, "patchDocument", args);

	const createDraft = (data: Record<string, unknown>): Promise<PageDoc> =>
		booted.payload.create({
			collection: "pages",
			locale: "en",
			draft: true,
			data,
		}) as Promise<PageDoc>;

	const readDraft = (id: number | string, locale = "en"): Promise<PageDoc> =>
		booted.payload.findByID({
			collection: "pages",
			id,
			depth: 0,
			draft: true,
			locale,
			fallbackLocale: false,
		}) as Promise<PageDoc>;

	it("writes a draft and reports what still blocks publishing", async () => {
		const page = await createDraft({ title: "Draft", slug: "draft" });
		const result = await patch({
			collection: "pages",
			id: page.id,
			locale: "en",
			patches: [{ op: "replace", path: "/title", value: "Renamed" }],
		});

		expect(result.isError).toBe(false);
		expect(result.data["status"]).toBe("draft");
		expect(result.data["publishBlockers"]).toEqual([
			expect.objectContaining({ path: "layout.sections" }),
		]);
		expect((await readDraft(page.id)).title).toBe("Renamed");
	});

	it("appends a block with /- and a blockType", async () => {
		const page = await createDraft({ title: "Blocks", slug: "blocks" });
		const result = await patch({
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

		const saved = await readDraft(page.id);
		const [first] = saved.layout?.sections ?? [];

		expect(first?.["blockType"]).toBe("sectionWrapper");
		expect(first?.["identifier"]).toBe("intro");
		expect((first?.["modules"] as { blockType: string }[])[0]?.blockType).toBe(
			"hero",
		);
	});

	it("does not flag a whole blocks field as notApplied", async () => {
		const page = await createDraft({
			title: "Whole field",
			slug: "whole-field",
			layout: { sections: [section("old")] },
		});
		const result = await patch({
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

		const [first] = (await readDraft(page.id)).layout?.sections ?? [];

		expect(first?.["identifier"]).toBe("fresh");
	});

	it("applies nothing when one operation in the batch is invalid", async () => {
		const page = await createDraft({ title: "Atomic", slug: "atomic" });
		const result = await patch({
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
		expect((await readDraft(page.id)).title).toBe("Atomic");
	});

	it("refuses remove on a field but allows it on a list element", async () => {
		const page = await createDraft({
			title: "Remove",
			slug: "remove",
			layout: { color: "dark", sections: [section("a"), section("b")] },
		});

		const onField = await patch({
			collection: "pages",
			id: page.id,
			locale: "en",
			patches: [{ op: "remove", path: "/layout/color" }],
		});
		const onElement = await patch({
			collection: "pages",
			id: page.id,
			locale: "en",
			patches: [{ op: "remove", path: "/layout/sections/0" }],
		});

		expect(onField.isError).toBe(true);
		expect(JSON.stringify(onField.data["problems"])).toContain("replace");
		expect(onElement.isError).toBe(false);

		const saved = await readDraft(page.id);

		expect(saved.layout?.color).toBe("dark");
		expect(saved.layout?.sections?.map((s) => s["identifier"])).toEqual(["b"]);
	});

	it("refuses a pointer to a field Payload maintains", async () => {
		const page = await createDraft({ title: "Status", slug: "status" });
		const result = await patch({
			collection: "pages",
			id: page.id,
			locale: "en",
			patches: [{ op: "replace", path: "/_status", value: "published" }],
		});

		expect(result.isError).toBe(true);
		expect((await readDraft(page.id))._status).toBe("draft");
	});

	it("forces every MCP write into a draft at the operation level", async () => {
		const page = await createDraft({
			title: "Guarded",
			slug: "guarded",
			layout: { sections: [section("intro", [hero("Hello")])] },
		});
		const { payload } = booted;
		const user = (await payload.findByID({
			collection: "users",
			id: seeded.userId,
		})) as TypedUser;
		const req = await createLocalReq(
			{
				user: { ...user, collection: "users" },
				context: {
					mcpx: {
						apiKeyId: "test",
						capabilities: { collections: {}, globals: {}, tools: {} },
					},
				},
			},
			payload,
		);

		await payload.update({
			collection: "pages",
			id: page.id,
			data: { title: "Published by tool", _status: "published" },
			draft: false,
			overrideAccess: false,
			req,
		});

		const draft = await readDraft(page.id);
		const live = (await payload.findByID({
			collection: "pages",
			id: page.id,
			depth: 0,
			draft: false,
		})) as PageDoc;

		expect(draft.title).toBe("Published by tool");
		expect(draft._status).toBe("draft");
		expect(live._status).toBe("draft");
	});

	it("refuses a stale expectedUpdatedAt", async () => {
		const page = await createDraft({ title: "Stale", slug: "stale" });
		const first = await patch({
			collection: "pages",
			id: page.id,
			locale: "en",
			expectedUpdatedAt: page.updatedAt,
			patches: [{ op: "replace", path: "/title", value: "Second" }],
		});
		const second = await patch({
			collection: "pages",
			id: page.id,
			locale: "en",
			expectedUpdatedAt: page.updatedAt,
			patches: [{ op: "replace", path: "/title", value: "Third" }],
		});

		expect(first.isError).toBe(false);
		expect(second.isError).toBe(true);
		expect(second.data["updatedAt"]).toBe(first.data["updatedAt"]);
		expect((await readDraft(page.id)).title).toBe("Second");
	});

	it("leaves the published version untouched", async () => {
		const page = (await booted.payload.create({
			collection: "pages",
			locale: "en",
			data: {
				title: "Live",
				slug: "live",
				layout: { sections: [section("intro", [hero("Hello")])] },
				_status: "published",
			},
		})) as PageDoc;

		const result = await patch({
			collection: "pages",
			id: page.id,
			locale: "en",
			patches: [{ op: "replace", path: "/title", value: "Live, edited" }],
		});
		const live = (await booted.payload.findByID({
			collection: "pages",
			id: page.id,
			depth: 0,
			draft: false,
		})) as PageDoc;

		expect(result.data["status"]).toBe("draft");
		expect(live.title).toBe("Live");
		expect(live._status).toBe("published");
		expect((await readDraft(page.id)).title).toBe("Live, edited");
	});

	it("writes one locale without touching or copying the other", async () => {
		const page = await createDraft({ title: "Home", slug: "home" });

		const titleInDe = await patch({
			collection: "pages",
			id: page.id,
			locale: "de",
			patches: [{ op: "replace", path: "/title", value: "Startseite" }],
		});
		const colorInDe = await patch({
			collection: "pages",
			id: page.id,
			locale: "de",
			patches: [{ op: "replace", path: "/layout/color", value: "dark" }],
		});

		expect(titleInDe.isError).toBe(false);
		expect(colorInDe.isError).toBe(false);
		expect((await readDraft(page.id, "en")).title).toBe("Home");
		expect((await readDraft(page.id, "de")).title).toBe("Startseite");

		const other = await createDraft({ title: "Only english", slug: "only-en" });

		await patch({
			collection: "pages",
			id: other.id,
			locale: "de",
			patches: [{ op: "replace", path: "/layout/color", value: "light" }],
		});

		const de = await readDraft(other.id, "de");

		expect(de.layout?.color).toBe("light");
		expect(de.title ?? null).toBeNull();
		expect((await readDraft(other.id, "en")).title).toBe("Only english");
	});

	interface PostDoc {
		id: number | string;
		items?: {
			id?: string;
			heading?: string | null;
			actions?: { id?: string; label?: string }[];
		}[];
	}

	const createPost = (data: Record<string, unknown>): Promise<PostDoc> =>
		booted.payload.create({
			collection: "posts",
			locale: "en",
			draft: true,
			data,
		});

	const readPost = (id: number | string, locale: string): Promise<PostDoc> =>
		booted.payload.findByID({
			collection: "posts",
			id,
			depth: 0,
			draft: true,
			locale,
			fallbackLocale: false,
		});

	it("patches a scalar inside a block nested under an array field", async () => {
		const post = await createPost({
			title: "Post",
			items: [
				{ heading: "One", actions: [{ blockType: "cta", label: "Old" }] },
			],
		});
		const result = await patch({
			collection: "posts",
			id: post.id,
			locale: "en",
			patches: [
				{ op: "replace", path: "/items/0/actions/0/label", value: "New" },
			],
		});

		expect(result.isError).toBe(false);
		expect(result.data).not.toHaveProperty("notApplied");

		const saved = await readPost(post.id, "en");

		expect(saved.items?.[0]?.actions?.[0]?.label).toBe("New");
	});

	it("keeps row identity on a whole-field replace, so other locales survive", async () => {
		const post = await createPost({
			title: "Post",
			items: [{ heading: "English", actions: [] }],
		});

		const inDe = await patch({
			collection: "posts",
			id: post.id,
			locale: "de",
			patches: [{ op: "replace", path: "/items/0/heading", value: "Deutsch" }],
		});

		expect(inDe.isError).toBe(false);

		const before = await readPost(post.id, "en");
		const row = before.items?.[0];
		const inEn = await patch({
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

		const en = await readPost(post.id, "en");

		expect(en.items?.[0]?.heading).toBe("English, edited");
		expect(en.items?.[0]?.id).toBe(row?.id);
		expect((await readPost(post.id, "de")).items?.[0]?.heading).toBe("Deutsch");
	});
});
