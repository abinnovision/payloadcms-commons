import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMcpClient } from "./helpers/mcp.js";
import { bootPayload, seedKeys } from "./helpers/payload.js";
import { hero, section } from "../builders/blocks.js";
import { node, state, text } from "../builders/lexical.js";

import type { McpClient } from "./helpers/mcp.js";
import type { Booted } from "./helpers/payload.js";

describe("read tools", () => {
	let booted: Booted;
	let mcp: McpClient;
	let pageId: number | string;

	beforeAll(async () => {
		booted = await bootPayload();
		mcp = createMcpClient(booted, (await seedKeys(booted.payload)).keys.full);

		const { payload } = booted;

		for (const index of [1, 2, 3]) {
			await payload.create({
				collection: "pages",
				locale: "en",
				draft: true,
				data: {
					title: `Page ${String(index)}`,
					slug: `page-${String(index)}`,
					layout: {
						sections: [section("intro", [hero(`Hero ${String(index)}`)])],
					},
				},
			});
		}

		const page = await payload.create({
			collection: "pages",
			locale: "en",
			data: {
				title: "Published",
				slug: "published",
				layout: { sections: [section("intro", [hero("Hello")])] },
				_status: "published",
			},
		});

		pageId = page.id;

		await payload.update({
			collection: "pages",
			id: pageId,
			locale: "de",
			draft: true,
			data: { title: "Veröffentlicht" },
		});
		await payload.update({
			collection: "pages",
			id: pageId,
			locale: "en",
			draft: true,
			data: { title: "Pending draft" },
		});
	});

	afterAll(async () => {
		await booted.payload.destroy();
	});

	it("finds documents with the defaults", async () => {
		const result = await mcp.call("findDocuments", { collection: "pages" });

		expect(result.isError).toBe(false);
		expect(result.data["totalDocs"]).toBe(4);
		expect(result.data["limit"]).toBe(10);
	});

	it("refuses a limit above the configured cap", async () => {
		const result = await mcp.call("findDocuments", {
			collection: "pages",
			limit: 100,
		});

		expect(result.isError).toBe(true);
		expect(result.text).toContain(
			"Too big: expected number to be <=25 at limit",
		);
	});

	it("applies where, select and sort", async () => {
		const result = await mcp.call("findDocuments", {
			collection: "pages",
			where: { slug: { like: "page-" } },
			select: { title: true },
			sort: "-slug",
			limit: 2,
		});
		const docs = result.data["docs"] as Record<string, unknown>[];

		expect(result.data["totalDocs"]).toBe(3);
		expect(docs.map((d) => d["title"])).toEqual(["Page 3", "Page 2"]);
		expect(docs[0]).not.toHaveProperty("slug");
	});

	it("reads in the requested locale", async () => {
		const de = await mcp.call("findDocuments", {
			collection: "pages",
			where: { slug: { equals: "published" } },
			locale: "de",
		});
		const docs = de.data["docs"] as Record<string, unknown>[];

		expect(docs[0]?.["title"]).toBe("Veröffentlicht");
	});

	it("shows a value missing in the requested locale from the default locale", async () => {
		const page = await booted.payload.create({
			collection: "pages",
			locale: "en",
			draft: true,
			data: { title: "Only English", slug: "only-english" },
		});
		const found = await mcp.call("findDocuments", {
			collection: "pages",
			where: { slug: { equals: "only-english" } },
			locale: "de",
		});
		const got = await mcp.call("getDocument", {
			collection: "pages",
			id: page.id,
			locale: "de",
		});

		expect(
			(found.data["docs"] as Record<string, unknown>[])[0]?.["title"],
		).toBe("Only English");
		expect(got.data["title"]).toBe("Only English");
	});

	it("returns the pending draft by default and the live document on request", async () => {
		const draft = await mcp.call("getDocument", {
			collection: "pages",
			id: pageId,
		});
		const live = await mcp.call("getDocument", {
			collection: "pages",
			id: pageId,
			draft: false,
		});

		expect(draft.data["title"]).toBe("Pending draft");
		expect(draft.data["_status"]).toBe("draft");
		expect(live.data["title"]).toBe("Published");
		expect(live.data["_status"]).toBe("published");
	});

	it("returns one subtree for a pointer", async () => {
		const result = await mcp.call("getDocument", {
			collection: "pages",
			id: pageId,
			path: "/layout/sections/0/identifier",
		});

		expect(result.data["path"]).toBe("/layout/sections/0/identifier");
		expect(result.data["value"]).toBe("intro");
		expect(result.data).toHaveProperty("updatedAt");
	});

	it("refuses a path that is not a JSON pointer", async () => {
		const result = await mcp.call("getDocument", {
			collection: "pages",
			id: pageId,
			path: "layout.sections.0.identifier",
		});

		expect(result.isError).toBe(true);
		expect(result.text).toMatch(
			/Invalid string: must match pattern .+ at path$/,
		);
	});

	it("refuses a depth above the configured cap", async () => {
		const result = await mcp.call("getDocument", {
			collection: "pages",
			id: pageId,
			depth: 5,
		});

		expect(result.isError).toBe(true);
		expect(result.text).toContain(
			"Too big: expected number to be <=1 at depth",
		);
	});

	describe("outlining a rich text field", () => {
		/**
		 * A post whose summary holds one h4 heading.
		 */
		const createOutlined = async (): Promise<number | string> =>
			(
				await booted.payload.create({
					collection: "posts",
					locale: "en",
					draft: true,
					data: {
						title: "Outlined",
						summary: state([node("heading", { tag: "h4" }, [text("Heading")])]),
					},
				})
			).id;

		it("answers with a position, a version and the narrowed properties", async () => {
			const postId = await createOutlined();
			const result = await mcp.call("getDocument", {
				collection: "posts",
				id: postId,
				path: "/summary",
				outline: true,
			});

			expect(result.isError).toBe(false);
			expect(result.data).not.toHaveProperty("value");
			expect(result.data["outline"]).toEqual([
				{
					children: 1,
					options: { tag: "h4" },
					pointer: "/summary/root/children/0",
					text: "Heading",
					type: "heading",
					version: 1,
				},
				{
					pointer: "/summary/root/children/0/children/0",
					text: "Heading",
					type: "text",
					version: 1,
				},
			]);
		});

		it("answers with a pointer and a version a patch can build on", async () => {
			const postId = await createOutlined();
			const outlined = await mcp.call("getDocument", {
				collection: "posts",
				id: postId,
				path: "/summary",
				outline: true,
			});
			const [first] = outlined.data["outline"] as {
				pointer: string;
				version: number;
			}[];

			/* The version comes from the outline, which is why it is reported. */
			const patched = await mcp.call("patchDocument", {
				collection: "posts",
				id: postId,
				locale: "en",
				patches: [
					{
						op: "add",
						path: `${first!.pointer}/children/-`,
						value: { ...text(" appended"), version: first!.version },
					},
				],
			});

			expect(patched.isError).toBe(false);

			const after = await mcp.call("getDocument", {
				collection: "posts",
				id: postId,
				path: "/summary",
				outline: true,
			});

			expect(after.data["outline"]).toMatchObject([
				{ children: 2, pointer: "/summary/root/children/0" },
				{ pointer: "/summary/root/children/0/children/0" },
				{
					pointer: "/summary/root/children/0/children/1",
					text: " appended",
				},
			]);
		});

		it("refuses anything that is not a rich text field", async () => {
			const postId = await createOutlined();
			const withoutPath = await mcp.call("getDocument", {
				collection: "posts",
				id: postId,
				outline: true,
			});
			const wrongField = await mcp.call("getDocument", {
				collection: "posts",
				id: postId,
				path: "/title",
				outline: true,
			});
			const insideTheState = await mcp.call("getDocument", {
				collection: "posts",
				id: postId,
				path: "/summary/root/children/0",
				outline: true,
			});

			for (const result of [withoutPath, wrongField, insideTheState]) {
				expect(result.isError).toBe(true);
				expect(result.data["error"]).toBe(
					'"outline" applies to a rich text field; give "path" for one.',
				);
			}
		});
	});
});
