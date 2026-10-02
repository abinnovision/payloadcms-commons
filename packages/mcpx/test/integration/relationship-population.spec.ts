import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMcpClient, responseText } from "./helpers/mcp.js";
import { bootPayload, seedKeysFor } from "./helpers/payload.js";
import { apiKeyUsers, articles } from "../fixtures/security.js";

import type { CallResult, McpClient } from "./helpers/mcp.js";
import type { Booted } from "./helpers/payload.js";

const CACHE_KEY = "mcpx-integration-relationship-population";

const AUTHOR = {
	email: "aaa-author@example.com",
	apiKey: "author-payload-api-key-0000000001",
};
const OTHER_AUTHOR_EMAIL = "zzz-author@example.com";

/**
 * Exposure stops at the allow-list, but a relationship reaches past it: an
 * exposed document may point at a user. Population stops at the collections
 * the key may read, and a where or sort through the relation into one it
 * cannot read is refused.
 */
describe("relationships into the user collection", () => {
	let booted: Booted;
	let mcp: McpClient;
	let authorId: number | string;
	let articleId: number | string;
	let otherArticleId: number | string;
	let versionId: number | string;

	beforeAll(async () => {
		booted = await bootPayload({
			key: CACHE_KEY,
			users: apiKeyUsers,
			collections: [articles],
			plugin: { collections: { articles: { versions: true } } },
		});

		const { payload } = booted;
		const author = await payload.create({
			collection: "users",
			data: {
				email: AUTHOR.email,
				password: "author-secret",
				enableAPIKey: true,
				apiKey: AUTHOR.apiKey,
			},
		});
		const otherAuthor = await payload.create({
			collection: "users",
			data: { email: OTHER_AUTHOR_EMAIL, password: "author-secret" },
		});

		const article = await payload.create({
			collection: "articles" as never,
			data: { title: "Draft one", author: author.id },
		});

		await payload.update({
			collection: "articles" as never,
			id: article.id,
			data: { title: "Final one" },
		});

		const other = await payload.create({
			collection: "articles" as never,
			data: { title: "Other", author: otherAuthor.id },
		});

		authorId = author.id;
		articleId = article.id;
		otherArticleId = other.id;

		const versions = await payload.findVersions({
			collection: "articles" as never,
			where: { parent: { equals: article.id } },
			sort: "createdAt",
		});

		versionId = versions.docs[0]?.id as number | string;

		const { keys } = await seedKeysFor(payload, {
			reader: { collections: { articles: { read: true } } },
		});

		mcp = createMcpClient(booted, keys.reader);
	});

	afterAll(async () => {
		await booted.payload.destroy();
	});

	const reads: [string, () => Promise<CallResult>][] = [
		[
			"getDocument",
			() =>
				mcp.call("getDocument", {
					collection: "articles",
					id: articleId,
					depth: 1,
				}),
		],
		[
			"findDocuments",
			() => mcp.call("findDocuments", { collection: "articles", depth: 1 }),
		],
		[
			"getDocument with versionId",
			() =>
				mcp.call("getDocument", {
					collection: "articles",
					id: articleId,
					versionId,
					depth: 1,
				}),
		],
	];

	it("returns the author as its id at depth 1", async () => {
		const result = await mcp.call("getDocument", {
			collection: "articles",
			id: articleId,
			depth: 1,
		});

		expect(result.isError).toBe(false);
		expect(result.data["author"]).toBe(authorId);
	});

	for (const [tool, read] of reads) {
		it(`withholds the related user's Payload API key at depth 1 through ${tool}`, async () => {
			const result = await read();

			expect(result.isError).toBe(false);
			expect(responseText(result)).not.toContain(AUTHOR.apiKey);
		});

		it(`withholds the related user's email at depth 1 through ${tool}`, async () => {
			const result = await read();

			expect(result.isError).toBe(false);
			expect(responseText(result)).not.toContain(AUTHOR.email);
		});
	}

	const idsOf = (result: CallResult): unknown[] =>
		((result.data["docs"] as { id: unknown }[] | undefined) ?? []).map(
			(doc) => doc.id,
		);

	const refusal = (path: string) => ({
		error: `This key cannot query through "${path}".`,
		status: 400,
	});

	it("refuses a where on the related user's email", async () => {
		const result = await mcp.call("findDocuments", {
			collection: "articles",
			where: { "author.email": { equals: AUTHOR.email } },
		});

		expect(result.data).toEqual(refusal("author.email"));
	});

	it("refuses a where on whether the related user has an API key", async () => {
		const result = await mcp.call("findDocuments", {
			collection: "articles",
			where: { "author.apiKey": { exists: true } },
		});

		expect(result.data).toEqual(refusal("author.apiKey"));
	});

	it("refuses to order by the related user's email", async () => {
		const result = await mcp.call("findDocuments", {
			collection: "articles",
			sort: "author.email",
		});

		expect(result.data).toEqual(refusal("author.email"));
	});

	it("finds both articles without a filter", async () => {
		const all = await mcp.call("findDocuments", { collection: "articles" });

		expect(idsOf(all).sort()).toEqual([articleId, otherArticleId].sort());
	});
});
