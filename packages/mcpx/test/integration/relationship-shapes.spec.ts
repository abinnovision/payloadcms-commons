import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { callTool } from "./helpers/mcp.js";
import { bootPayload, createKey } from "./helpers/payload.js";
import {
	apiKeyUsers,
	articles,
	dispatches,
	remarks,
} from "../fixtures/security.js";

import type { Booted } from "./helpers/payload.js";

const CACHE_KEY = "mcpx-integration-relationship-shapes";

const AUTHOR = {
	email: "shapes-author@example.com",
	apiKey: "author-payload-api-key-0000000002",
};

/** A one-pixel PNG, so a real file lands on disk without needing sharp. */
const PIXEL = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
	"base64",
);

const lexicalRoot = (
	children: Record<string, unknown>[],
): Record<string, unknown> => ({
	root: {
		type: "root",
		version: 1,
		direction: null,
		format: "",
		indent: 0,
		children,
	},
});

/**
 * Every field shape Payload populates, pointed at collections the key cannot
 * read, and a readable collection that points onward at one it cannot.
 */
describe("relationships across field shapes", () => {
	let booted: Booted;
	let key: string;
	let authorId: number | string;
	let mediaId: number | string;
	let remarkId: number | string;
	let articleId: number | string;
	let closedId: number | string;
	let closedVersionId: number | string;
	let openId: number | string;
	let openVersionId: number | string;

	const firstVersion = async (id: number | string) => {
		const versions = await booted.payload.findVersions({
			collection: "dispatches" as never,
			where: { parent: { equals: id } },
			sort: "createdAt",
		});

		return versions.docs[0]?.id as number | string;
	};

	beforeAll(async () => {
		booted = await bootPayload({
			key: CACHE_KEY,
			users: apiKeyUsers,
			collections: [articles, dispatches, remarks],
			plugin: {
				collections: { articles: true, dispatches: true },
				limits: { maxDepth: 2 },
			},
		});

		const { payload } = booted;
		const reader = await payload.create({
			collection: "users",
			data: { email: "shapes-reader@example.com", password: "reader-secret" },
		});
		const author = await payload.create({
			collection: "users",
			data: {
				email: AUTHOR.email,
				password: "author-secret",
				enableAPIKey: true,
				apiKey: AUTHOR.apiKey,
			},
		});
		const media = await payload.create({
			collection: "media" as never,
			data: { alt: "Pixel" },
			file: {
				data: PIXEL,
				mimetype: "image/png",
				name: "pixel.png",
				size: PIXEL.length,
			},
		});
		const article = await payload.create({
			collection: "articles" as never,
			data: { title: "Readable", author: author.id },
		});

		authorId = author.id;
		mediaId = media.id;
		articleId = article.id;

		const closed = await payload.create({
			collection: "dispatches" as never,
			data: {
				title: "Closed",
				reviewers: [author.id],
				subjects: [{ relationTo: "users", value: author.id }],
				attachment: media.id,
				meta: { owner: author.id },
				entries: [{ person: author.id }],
				sections: [{ blockType: "mention", person: author.id }],
				body: lexicalRoot([
					{
						type: "relationship",
						version: 2,
						format: "",
						relationTo: "users",
						value: author.id,
					},
					{
						type: "upload",
						version: 3,
						format: "",
						id: "000000000000000000000001",
						fields: null,
						relationTo: "media",
						value: media.id,
					},
					{
						type: "paragraph",
						version: 1,
						direction: null,
						format: "",
						indent: 0,
						children: [
							{
								type: "link",
								version: 3,
								direction: null,
								format: "",
								indent: 0,
								id: "000000000000000000000002",
								fields: {
									linkType: "internal",
									newTab: false,
									doc: { relationTo: "users", value: author.id },
								},
								children: [
									{
										type: "text",
										version: 1,
										detail: 0,
										format: 0,
										mode: "normal",
										style: "",
										text: "author",
									},
								],
							},
						],
					},
				]),
			},
		});
		const remark = await payload.create({
			collection: "remarks" as never,
			data: { text: "Seen", dispatch: closed.id },
		});
		const open = await payload.create({
			collection: "dispatches" as never,
			data: {
				title: "Open",
				article: article.id,
				subjects: [
					{ relationTo: "articles", value: article.id },
					{ relationTo: "users", value: author.id },
				],
			},
		});

		remarkId = remark.id;
		closedId = closed.id;
		openId = open.id;
		closedVersionId = await firstVersion(closed.id);
		openVersionId = await firstVersion(open.id);

		key = await createKey(payload, {
			userId: reader.id,
			label: "shapes-reader",
			capabilities: {
				collections: { articles: { read: true }, dispatches: { read: true } },
			},
		});
	});

	afterAll(async () => {
		await booted.payload.destroy();
		await rm(join(tmpdir(), "mcpx-fixture-media"), {
			recursive: true,
			force: true,
		});
	});

	const call = (name: string, args: Record<string, unknown>) =>
		callTool(booted.config, key, name, args, CACHE_KEY);

	type Read = (
		id: number | string,
		versionId: number | string,
		depth: number,
	) => Promise<Record<string, unknown>>;

	/** Each read path, returning the dispatch whichever tool returned it. */
	const reads: [string, Read][] = [
		[
			"getDocument",
			async (id, _versionId, depth) =>
				(await call("getDocument", { collection: "dispatches", id, depth }))
					.data,
		],
		[
			"findDocuments",
			async (id, _versionId, depth) => {
				const result = await call("findDocuments", {
					collection: "dispatches",
					where: { id: { equals: id } },
					depth,
				});

				return (result.data["docs"] as Record<string, unknown>[])[0] ?? {};
			},
		],
		[
			"getDocument with versionId",
			async (id, versionId, depth) =>
				(
					await call("getDocument", {
						collection: "dispatches",
						id,
						versionId,
						depth,
					})
				).data,
		],
	];

	for (const [tool, read] of reads) {
		it(`returns relations into unreadable collections at depth 1 as at depth 0 through ${tool}`, async () => {
			const shallow = await read(closedId, closedVersionId, 0);
			const deep = await read(closedId, closedVersionId, 1);

			expect(deep["title"]).toBe("Closed");
			expect(deep).toEqual(shallow);
			expect(JSON.stringify(deep)).not.toContain(AUTHOR.email);
			expect(JSON.stringify(deep)).not.toContain(AUTHOR.apiKey);
		});

		it(`stops at an unreadable collection behind a readable one at depth 2 through ${tool}`, async () => {
			const doc = await read(openId, openVersionId, 2);
			const article = doc["article"] as Record<string, unknown>;

			expect(article["title"]).toBe("Readable");
			expect(article["author"]).toBe(authorId);
			expect(JSON.stringify(doc)).not.toContain(AUTHOR.email);
			expect(JSON.stringify(doc)).not.toContain(AUTHOR.apiKey);
		});
	}

	it("returns each unreadable relation as its bare id at depth 1", async () => {
		const result = await call("getDocument", {
			collection: "dispatches",
			id: closedId,
			depth: 1,
		});
		const { data } = result;
		const body = (data["body"] as { root: { children: unknown[] } }).root
			.children as Record<string, unknown>[];
		const link = (body[2]?.["children"] as Record<string, unknown>[])[0];

		expect(result.isError).toBe(false);
		expect(data["reviewers"]).toEqual([authorId]);
		expect(data["subjects"]).toEqual([
			{ relationTo: "users", value: authorId },
		]);
		expect(data["attachment"]).toBe(mediaId);
		expect(data["meta"]).toEqual({ owner: authorId });
		expect(data["entries"]).toEqual([
			expect.objectContaining({ person: authorId }),
		]);
		expect(data["sections"]).toEqual([
			expect.objectContaining({ blockType: "mention", person: authorId }),
		]);
		expect(body[0]).toMatchObject({ type: "relationship", value: authorId });
		expect(body[1]).toMatchObject({ type: "upload", value: mediaId });
		expect(link?.["fields"]).toMatchObject({
			doc: { relationTo: "users", value: authorId },
		});
	});

	/* A draft read goes to the versions table, which holds no join. */
	it("returns a join into an unreadable collection as ids at depth 1", async () => {
		const read = (depth: number) =>
			call("getDocument", {
				collection: "dispatches",
				id: closedId,
				draft: false,
				depth,
			});
		const shallow = await read(0);
		const deep = await read(1);

		expect(deep.data["remarks"]).toMatchObject({ docs: [remarkId] });
		expect(deep.data).toEqual(shallow.data);
	});

	it("populates relations into readable collections", async () => {
		const result = await call("getDocument", {
			collection: "dispatches",
			id: openId,
			depth: 1,
		});
		const subjects = result.data["subjects"] as {
			relationTo: string;
			value: unknown;
		}[];

		expect(result.isError).toBe(false);
		expect(result.data["article"]).toMatchObject({
			id: articleId,
			title: "Readable",
		});
		expect(subjects[0]?.value).toMatchObject({
			id: articleId,
			title: "Readable",
		});
		expect(subjects[1]).toEqual({ relationTo: "users", value: authorId });
	});
});
