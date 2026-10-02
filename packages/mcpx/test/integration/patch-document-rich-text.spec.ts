import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMcpClient } from "./helpers/mcp.js";
import {
	bootPayload,
	createDraft,
	readDraft,
	seedKeys,
} from "./helpers/payload.js";
import { bulletList, node, state, text } from "../builders/lexical.js";

import type { McpClient } from "./helpers/mcp.js";
import type { Booted } from "./helpers/payload.js";

interface PostDoc {
	id: number | string;
	content?: { root: { children: Record<string, unknown>[] } };
}

/** An editor state holding one link node carrying `fields`. */
const linkState = (fields: Record<string, unknown>) =>
	state([node("link", { fields, version: 3 }, [text("x")])]);

const headingState = (tag: string, children: unknown[] = []) =>
	state([node("heading", { tag }, children)]);

const paragraphNode = (value: string) => node("paragraph", {}, [text(value)]);

describe("patchDocument on rich text", () => {
	let booted: Booted;
	let mcp: McpClient;

	beforeAll(async () => {
		booted = await bootPayload();
		mcp = createMcpClient(booted, (await seedKeys(booted.payload)).keys.full);
	});

	afterAll(async () => {
		await booted.payload.destroy();
	});

	const createPost = (data: Record<string, unknown>) =>
		createDraft<PostDoc>(booted.payload, "posts", { title: "Post", ...data });

	const readPost = (id: number | string, locale = "en") =>
		readDraft<PostDoc>(booted.payload, "posts", id, locale);

	/** Writes `value` over a whole rich text field of the post. */
	const replaceField = (
		id: number | string,
		path: "/content" | "/summary",
		value: unknown,
	) =>
		mcp.call("patchDocument", {
			collection: "posts",
			id,
			locale: "en",
			patches: [{ op: "replace", path, value }],
		});

	it("refuses a heading size the field's editor does not enable", async () => {
		const post = await createPost({});

		const refused = await replaceField(post.id, "/summary", headingState("h3"));

		expect(refused.isError).toBe(true);
		expect(refused.text).toContain("h4");
		expect(
			(await replaceField(post.id, "/summary", headingState("h4"))).isError,
		).toBe(false);
	});

	it("refuses a Lexical link field the editor does not declare", async () => {
		const post = await createPost({});
		const result = await replaceField(
			post.id,
			"/content",
			linkState({ relation: "nofollow", url: "/x" }),
		);

		expect(result.isError).toBe(true);
		expect(JSON.stringify(result.data)).toContain(
			"/content/root/children/0/fields/relation: no such field",
		);
	});

	it("refuses a list node missing what the editor hydrates it from", async () => {
		const post = await createPost({});

		const refused = await replaceField(
			post.id,
			"/content",
			bulletList("One", { stripIndent: true }),
		);

		expect(refused.isError).toBe(true);
		expect(JSON.stringify(refused.data)).toContain(
			'a \\"listitem\\" node is missing \\"indent\\"',
		);

		const saved = await readPost(post.id);

		expect(saved.content ?? null).toBeNull();
		expect(
			(await replaceField(post.id, "/content", bulletList("One"))).isError,
		).toBe(false);
	});

	it("writes a Lexical link field the editor declares", async () => {
		const post = await createPost({});
		const result = await replaceField(
			post.id,
			"/content",
			linkState({ linkType: "custom", rel: "nofollow", url: "/x" }),
		);

		expect(result.isError).toBe(false);

		const saved = await readPost(post.id);

		expect(saved.content?.root.children[0]?.["fields"]).toMatchObject({
			rel: "nofollow",
			url: "/x",
		});
	});

	describe("positions inside a rich text field", () => {
		const nodesOf = (post: PostDoc): Record<string, unknown>[] =>
			post.content?.root.children ?? [];

		const patchPost = (
			id: number | string,
			patches: unknown[],
			locale = "en",
		) =>
			mcp.call("patchDocument", { collection: "posts", id, locale, patches });

		it("appends a node without rewriting the state", async () => {
			const post = await createPost({
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

			const saved = nodesOf(await readPost(post.id));

			expect(saved).toHaveLength(2);
			expect(saved[1]).toEqual(paragraphNode("Second"));
		});

		it("replaces one text node and leaves its siblings byte-identical", async () => {
			const post = await createPost({
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

			const saved = nodesOf(await readPost(post.id));

			expect(saved[0]).toEqual(paragraphNode("Edited"));
			expect(saved[1]).toEqual(paragraphNode("Second"));
		});

		it("refuses a node written without what Lexical serializes", async () => {
			const post = await createPost({
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
				summary: headingState("h4", [text("Summary")]),
			});
			const result = await patchPost(post.id, [
				{ op: "add", path: "/summary/root/children/-", value: node("quote") },
			]);

			expect(result.isError).toBe(true);
			expect(result.text).toContain("is not available in this field's editor");
		});

		it("checks a narrowed property written on its own", async () => {
			const post = await createPost({
				summary: headingState("h4", [text("Summary")]),
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
			const post = await createPost({ content: linkState({ url: "/x" }) });
			const accepted = await patchPost(post.id, [
				{
					op: "replace",
					path: "/content/root/children/0/fields/rel",
					value: "sponsored",
				},
			]);

			expect(accepted.isError).toBe(false);
			expect(nodesOf(await readPost(post.id))[0]?.["fields"]).toMatchObject({
				rel: "sponsored",
			});

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

			const saved = nodesOf(await readPost(post.id));

			expect(saved).toHaveLength(2);
			expect(saved[1]).toEqual(paragraphNode("Third"));
		});

		it("leaves the id of a Lexical block node alone", async () => {
			const post = await createPost({
				content: state([
					{
						fields: { blockType: "callout", id: "callout-row", tone: "info" },
						format: "",
						type: "block",
						version: 2,
					},
				]),
			});
			const result = await patchPost(post.id, [
				{
					op: "replace",
					path: "/content/root/children/0/fields/tone",
					value: "warning",
				},
			]);

			expect(result.isError).toBe(false);
			expect(nodesOf(await readPost(post.id))[0]?.["fields"]).toMatchObject({
				id: "callout-row",
				tone: "warning",
			});
		});

		it("checks expectedUpdatedAt before it looks at the state", async () => {
			const post = await createPost({
				content: state([paragraphNode("First")]),
			});
			const result = await mcp.call("patchDocument", {
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
			expect(nodesOf(await readPost(post.id))[0]).toEqual(
				paragraphNode("First"),
			);
		});

		it("refuses emptying the state, which Lexical cannot hydrate", async () => {
			const post = await createPost({
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

			expect(nodesOf(await readPost(post.id))).toHaveLength(1);
		});

		it("writes one locale's state without touching another", async () => {
			const post = await createPost({
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
			expect(nodesOf(await readPost(post.id))[0]).toEqual(
				paragraphNode("English"),
			);
		});
	});
});
