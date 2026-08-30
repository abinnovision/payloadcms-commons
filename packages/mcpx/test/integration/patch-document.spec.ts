import { createLocalReq } from "payload";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { callTool, toolsList } from "./helpers/mcp.js";
import {
	bootPayload,
	bulletList,
	hero,
	section,
	seedKeys,
} from "./helpers/payload.js";

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

	it("announces itself as destructive, because it removes and replaces", async () => {
		const tools = await toolsList(booted.config, seeded.keys.full);
		const tool = tools.find((candidate) => candidate.name === "patchDocument");

		expect(tool?.annotations).toMatchObject({ destructiveHint: true });
	});

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
			expect.objectContaining({ path: "/layout/sections" }),
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

	/** An editor state holding a single link node carrying `fields`. */
	const linkState = (fields: Record<string, unknown>) => ({
		root: {
			children: [
				{
					children: [
						{
							detail: 0,
							format: 0,
							mode: "normal",
							style: "",
							text: "x",
							type: "text",
							version: 1,
						},
					],
					direction: "ltr",
					fields,
					format: "",
					indent: 0,
					type: "link",
					version: 3,
				},
			],
			direction: "ltr",
			format: "",
			indent: 0,
			type: "root",
			version: 1,
		},
	});

	interface PostDoc {
		id: number | string;
		content?: {
			root: { children: { fields?: Record<string, unknown> }[] };
		};
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

	it("refuses a heading size the field's editor does not enable", async () => {
		const post = await createPost({ title: "Post" });
		const summary = (tag: string) => ({
			root: {
				children: [
					{
						children: [],
						direction: null,
						format: "",
						indent: 0,
						tag,
						type: "heading",
						version: 1,
					},
				],
				direction: null,
				format: "",
				indent: 0,
				type: "root",
				version: 1,
			},
		});
		const write = (tag: string) =>
			patch({
				collection: "posts",
				id: post.id,
				locale: "en",
				patches: [{ op: "replace", path: "/summary", value: summary(tag) }],
			});

		const refused = await write("h3");

		expect(refused.isError).toBe(true);
		expect(refused.text).toContain("h4");
		expect((await write("h4")).isError).toBe(false);
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

	it("refuses a Lexical link field the editor does not declare", async () => {
		const post = await createPost({ title: "Post" });
		const result = await patch({
			collection: "posts",
			id: post.id,
			locale: "en",
			patches: [
				{
					op: "replace",
					path: "/content",
					value: linkState({ relation: "nofollow", url: "/x" }),
				},
			],
		});

		expect(result.isError).toBe(true);
		expect(JSON.stringify(result.data)).toContain(
			"/content/root/children/0/fields/relation: no such field",
		);
	});

	it("refuses a list node missing what the editor hydrates it from", async () => {
		const post = await createPost({ title: "Post" });
		const write = (value: Record<string, unknown>) =>
			patch({
				collection: "posts",
				id: post.id,
				locale: "en",
				patches: [{ op: "replace", path: "/content", value }],
			});

		const refused = await write(bulletList("One", { stripIndent: true }));

		expect(refused.isError).toBe(true);
		expect(JSON.stringify(refused.data)).toContain(
			'a \\"listitem\\" node is missing \\"indent\\"',
		);

		const saved = await readPost(post.id, "en");

		expect(saved.content ?? null).toBeNull();
		expect((await write(bulletList("One"))).isError).toBe(false);
	});

	it("writes a Lexical link field the editor declares", async () => {
		const post = await createPost({ title: "Post" });
		const result = await patch({
			collection: "posts",
			id: post.id,
			locale: "en",
			patches: [
				{
					op: "replace",
					path: "/content",
					value: linkState({
						linkType: "custom",
						rel: "nofollow",
						url: "/x",
					}),
				},
			],
		});

		expect(result.isError).toBe(false);

		const saved = await readPost(post.id, "en");

		expect(saved.content?.root.children[0]?.fields).toMatchObject({
			rel: "nofollow",
			url: "/x",
		});
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

	describe("positions inside a rich text field", () => {
		const text = (value: string) => ({
			detail: 0,
			format: 0,
			mode: "normal",
			style: "",
			text: value,
			type: "text",
			version: 1,
		});

		const paragraphNode = (value: string) => ({
			children: [text(value)],
			direction: "ltr",
			format: "",
			indent: 0,
			type: "paragraph",
			version: 1,
		});

		const headingState = (tag: string) => ({
			root: {
				children: [
					{
						children: [text("Summary")],
						direction: "ltr",
						format: "",
						indent: 0,
						tag,
						type: "heading",
						version: 1,
					},
				],
				direction: "ltr",
				format: "",
				indent: 0,
				type: "root",
				version: 1,
			},
		});

		const state = (children: unknown[]) => ({
			root: {
				children,
				direction: "ltr",
				format: "",
				indent: 0,
				type: "root",
				version: 1,
			},
		});

		const nodesOf = (post: PostDoc): Record<string, unknown>[] =>
			post.content?.root.children ?? [];

		const patchPost = (
			id: number | string,
			patches: unknown[],
			locale = "en",
		) => patch({ collection: "posts", id, locale, patches });

		it("appends a node without rewriting the state", async () => {
			const post = await createPost({
				title: "Post",
				content: state([paragraphNode("First")]),
			});
			const result = await patchPost(post.id, [
				{
					op: "add",
					path: "/content/root/children/-",
					value: paragraphNode("Second"),
				},
			]);

			expect(result.isError).toBe(false);
			expect(result.data).not.toHaveProperty("notApplied");

			const saved = nodesOf(await readPost(post.id, "en"));

			expect(saved).toHaveLength(2);
			expect(saved[1]).toEqual(paragraphNode("Second"));
		});

		it("replaces one text node and leaves its siblings byte-identical", async () => {
			const post = await createPost({
				title: "Post",
				content: state([paragraphNode("First"), paragraphNode("Second")]),
			});
			const result = await patchPost(post.id, [
				{
					op: "replace",
					path: "/content/root/children/0/children/0/text",
					value: "Edited",
				},
			]);

			expect(result.isError).toBe(false);

			const saved = nodesOf(await readPost(post.id, "en"));

			expect(saved[0]).toEqual(paragraphNode("Edited"));
			expect(saved[1]).toEqual(paragraphNode("Second"));
		});

		it("refuses a node written without what Lexical serializes", async () => {
			const post = await createPost({
				title: "Post",
				content: state([paragraphNode("First")]),
			});
			const result = await patchPost(post.id, [
				{
					op: "add",
					path: "/content/root/children/-",
					value: { children: [], type: "paragraph" },
				},
			]);

			expect(result.isError).toBe(true);
			expect(result.data).toMatchObject({
				problems: [
					expect.stringContaining(
						'/content/root/children/-: a "paragraph" node is missing "direction", "indent", "version".',
					),
				],
			});
		});

		it("refuses a node type the editor does not have", async () => {
			const post = await createPost({
				title: "Post",
				summary: headingState("h4"),
			});
			const result = await patchPost(post.id, [
				{
					op: "add",
					path: "/summary/root/children/-",
					value: {
						children: [],
						direction: "ltr",
						format: "",
						indent: 0,
						type: "quote",
						version: 1,
					},
				},
			]);

			expect(result.isError).toBe(true);
			expect(result.text).toContain("is not available in this field's editor");
		});

		it("checks a narrowed property written on its own", async () => {
			const post = await createPost({
				title: "Post",
				summary: headingState("h4"),
			});
			const write = (tag: string) =>
				patchPost(post.id, [
					{ op: "replace", path: "/summary/root/children/0/tag", value: tag },
				]);

			const refused = await write("h3");

			expect(refused.isError).toBe(true);
			expect(refused.text).toContain("h4");
			expect((await write("h4")).isError).toBe(false);
		});

		it("writes and refuses a link node's own fields at a position", async () => {
			const post = await createPost({
				title: "Post",
				content: linkState({ url: "/x" }),
			});
			const accepted = await patchPost(post.id, [
				{
					op: "replace",
					path: "/content/root/children/0/fields/rel",
					value: "sponsored",
				},
			]);

			expect(accepted.isError).toBe(false);
			expect(
				nodesOf(await readPost(post.id, "en"))[0]?.["fields"],
			).toMatchObject({ rel: "sponsored" });

			const refused = await patchPost(post.id, [
				{
					op: "replace",
					path: "/content/root/children/0/fields/relation",
					value: "x",
				},
			]);

			expect(refused.isError).toBe(true);
			expect(refused.data).toMatchObject({
				problems: [
					expect.stringContaining(
						'"/relation" is not a field here. Available: /linkType, /url, /doc, /newTab, /rel',
					),
				],
			});
		});

		it("removes a node and shifts the ones after it", async () => {
			const post = await createPost({
				title: "Post",
				content: state([
					paragraphNode("First"),
					paragraphNode("Second"),
					paragraphNode("Third"),
				]),
			});
			const result = await patchPost(post.id, [
				{ op: "remove", path: "/content/root/children/1" },
			]);

			expect(result.isError).toBe(false);

			const saved = nodesOf(await readPost(post.id, "en"));

			expect(saved).toHaveLength(2);
			expect(saved[1]).toEqual(paragraphNode("Third"));
		});

		it("leaves the id of a Lexical block node alone", async () => {
			const blockNode = {
				fields: { blockType: "callout", id: "callout-row", tone: "info" },
				format: "",
				type: "block",
				version: 2,
			};
			const post = await createPost({
				title: "Post",
				content: state([blockNode]),
			});
			const result = await patchPost(post.id, [
				{
					op: "replace",
					path: "/content/root/children/0/fields/tone",
					value: "warning",
				},
			]);

			expect(result.isError).toBe(false);
			expect(
				nodesOf(await readPost(post.id, "en"))[0]?.["fields"],
			).toMatchObject({ id: "callout-row", tone: "warning" });
		});

		it("checks expectedUpdatedAt before it looks at the state", async () => {
			const post = await createPost({
				title: "Post",
				content: state([paragraphNode("First")]),
			});
			const result = await patch({
				collection: "posts",
				id: post.id,
				locale: "en",
				expectedUpdatedAt: "2020-01-01T00:00:00.000Z",
				patches: [
					{
						op: "replace",
						path: "/content/root/children/0/children/0/text",
						value: "Edited",
					},
				],
			});

			expect(result.isError).toBe(true);
			expect(nodesOf(await readPost(post.id, "en"))[0]).toEqual(
				paragraphNode("First"),
			);
		});

		it("refuses emptying the state, which Lexical cannot hydrate", async () => {
			const post = await createPost({
				title: "Post",
				content: state([paragraphNode("Only")]),
			});
			const emptied = await patchPost(post.id, [
				{ op: "replace", path: "/content/root/children", value: [] },
			]);
			const removed = await patchPost(post.id, [
				{ op: "remove", path: "/content/root/children/0" },
			]);

			for (const result of [emptied, removed]) {
				expect(result.isError).toBe(true);
				expect(JSON.stringify(result.data)).toContain(
					"needs at least one node",
				);
			}

			expect(nodesOf(await readPost(post.id, "en"))).toHaveLength(1);
		});

		it("writes one locale's state without touching another", async () => {
			const post = await createPost({
				title: "Post",
				content: state([paragraphNode("English")]),
			});

			await patchPost(
				post.id,
				[
					{
						op: "replace",
						path: "/content",
						value: state([paragraphNode("Deutsch")]),
					},
				],
				"de",
			);

			const result = await patchPost(
				post.id,
				[
					{
						op: "replace",
						path: "/content/root/children/0/children/0/text",
						value: "Bearbeitet",
					},
				],
				"de",
			);

			expect(result.isError).toBe(false);
			expect(nodesOf(await readPost(post.id, "de"))[0]).toEqual(
				paragraphNode("Bearbeitet"),
			);
			expect(nodesOf(await readPost(post.id, "en"))[0]).toEqual(
				paragraphNode("English"),
			);
		});
	});
});
