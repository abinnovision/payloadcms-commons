import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { callTool } from "./helpers/mcp.js";
import { bootPayload, hero, section, seedKeys } from "./helpers/payload.js";

import type { Booted, Seeded } from "./helpers/payload.js";

describe("read tools", () => {
	let booted: Booted;
	let seeded: Seeded;
	let pageId: number | string;

	beforeAll(async () => {
		booted = await bootPayload();
		seeded = await seedKeys(booted.payload);

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

	const call = (name: string, args: Record<string, unknown>) =>
		callTool(booted.config, seeded.keys.full, name, args);

	it("finds documents with the defaults", async () => {
		const result = await call("findDocuments", { collection: "pages" });

		expect(result.isError).toBe(false);
		expect(result.data["totalDocs"]).toBe(4);
		expect(result.data["limit"]).toBe(10);
	});

	it("refuses a limit above the configured cap", async () => {
		const result = await call("findDocuments", {
			collection: "pages",
			limit: 100,
		});

		expect(result.isError).toBe(true);
	});

	it("applies where, select and sort", async () => {
		const result = await call("findDocuments", {
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
		const de = await call("findDocuments", {
			collection: "pages",
			where: { slug: { equals: "published" } },
			locale: "de",
		});
		const docs = de.data["docs"] as Record<string, unknown>[];

		expect(docs[0]?.["title"]).toBe("Veröffentlicht");
	});

	it("returns the pending draft by default and the live document on request", async () => {
		const draft = await call("getDocument", {
			collection: "pages",
			id: pageId,
		});
		const live = await call("getDocument", {
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
		const result = await call("getDocument", {
			collection: "pages",
			id: pageId,
			path: "/layout/sections/0/identifier",
		});

		expect(result.data["path"]).toBe("/layout/sections/0/identifier");
		expect(result.data["value"]).toBe("intro");
		expect(result.data).toHaveProperty("updatedAt");
	});

	it("refuses a path that is not a JSON pointer", async () => {
		const result = await call("getDocument", {
			collection: "pages",
			id: pageId,
			path: "layout.sections.0.identifier",
		});

		expect(result.isError).toBe(true);
	});

	it("refuses a depth above the configured cap", async () => {
		const result = await call("getDocument", {
			collection: "pages",
			id: pageId,
			depth: 5,
		});

		expect(result.isError).toBe(true);
	});

	describe("outlining a rich text field", () => {
		const NODES = [
			{
				children: [
					{
						detail: 0,
						format: 0,
						mode: "normal",
						style: "",
						text: "Heading",
						type: "text",
						version: 1,
					},
				],
				direction: "ltr",
				format: "",
				indent: 0,
				tag: "h4",
				type: "heading",
				version: 1,
			},
		];

		let postId: number | string;

		beforeAll(async () => {
			const post = await booted.payload.create({
				collection: "posts",
				locale: "en",
				draft: true,
				data: {
					title: "Outlined",
					summary: {
						root: {
							children: NODES,
							direction: "ltr",
							format: "",
							indent: 0,
							type: "root",
							version: 1,
						},
					},
				},
			});

			postId = post.id;
		});

		it("answers with a position, a version and the narrowed properties", async () => {
			const result = await call("getDocument", {
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
			const outlined = await call("getDocument", {
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
			const patched = await callTool(
				booted.config,
				seeded.keys.full,
				"patchDocument",
				{
					collection: "posts",
					id: postId,
					locale: "en",
					patches: [
						{
							op: "add",
							path: `${first!.pointer}/children/-`,
							value: {
								detail: 0,
								format: 0,
								mode: "normal",
								style: "",
								text: " appended",
								type: "text",
								version: first!.version,
							},
						},
					],
				},
			);

			expect(patched.isError).toBe(false);

			const after = await call("getDocument", {
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
			const withoutPath = await call("getDocument", {
				collection: "posts",
				id: postId,
				outline: true,
			});
			const wrongField = await call("getDocument", {
				collection: "posts",
				id: postId,
				path: "/title",
				outline: true,
			});
			const insideTheState = await call("getDocument", {
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
