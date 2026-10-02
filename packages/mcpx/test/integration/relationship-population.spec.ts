import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { callTool } from "./helpers/mcp.js";
import { bootPayload, createKey } from "./helpers/payload.js";
import { apiKeyUsers, articles } from "../fixtures/security.js";

import type { CallResult } from "./helpers/mcp.js";
import type { Booted } from "./helpers/payload.js";

const CACHE_KEY = "mcpx-integration-relationship-population";

const AUTHOR = {
	email: "aaa-author@example.com",
	apiKey: "author-payload-api-key-0000000001",
};
const OTHER_AUTHOR_EMAIL = "zzz-author@example.com";

const textOf = (result: CallResult): string =>
	`${result.text ?? ""} ${result.rpcError?.message ?? ""}`;

/**
 * Exposure stops at the allow-list, but a relationship reaches past it: an
 * exposed document may point at a user. Population stops at the collections
 * the key may read, while a where or sort through the relation still reaches
 * the user document under Payload's own access rules.
 */
describe("relationships into the user collection", () => {
	let booted: Booted;
	let key: string;
	let authorId: number | string;
	let articleId: number | string;
	let otherArticleId: number | string;
	let versionId: number | string;

	beforeAll(async () => {
		booted = await bootPayload({
			key: CACHE_KEY,
			users: apiKeyUsers,
			collections: [articles],
			plugin: { collections: { articles: true } },
		});

		const { payload } = booted;
		const reader = await payload.create({
			collection: "users",
			data: { email: "reader@example.com", password: "reader-secret" },
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

		key = await createKey(payload, {
			userId: reader.id,
			label: "reader",
			capabilities: { collections: { articles: { read: true } } },
		});
	});

	afterAll(async () => {
		await booted.payload.destroy();
	});

	const call = (name: string, args: Record<string, unknown>) =>
		callTool(booted.config, key, name, args, CACHE_KEY);

	const reads: [string, () => Promise<CallResult>][] = [
		[
			"getDocument",
			() =>
				call("getDocument", {
					collection: "articles",
					id: articleId,
					depth: 1,
				}),
		],
		[
			"findDocuments",
			() => call("findDocuments", { collection: "articles", depth: 1 }),
		],
		[
			"getDocument with versionId",
			() =>
				call("getDocument", {
					collection: "articles",
					id: articleId,
					versionId,
					depth: 1,
				}),
		],
	];

	it("returns the author as its id at depth 1", async () => {
		const result = await call("getDocument", {
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
			expect(textOf(result)).not.toContain(AUTHOR.apiKey);
		});

		it(`withholds the related user's email at depth 1 through ${tool}`, async () => {
			const result = await read();

			expect(result.isError).toBe(false);
			expect(textOf(result)).not.toContain(AUTHOR.email);
		});
	}

	const idsOf = (result: CallResult): unknown[] =>
		((result.data["docs"] as { id: unknown }[] | undefined) ?? []).map(
			(doc) => doc.id,
		);

	const independentOf = async (
		matching: Record<string, unknown>,
		notMatching: Record<string, unknown>,
	): Promise<boolean> => {
		const hit = await call("findDocuments", {
			collection: "articles",
			...matching,
		});
		const miss = await call("findDocuments", {
			collection: "articles",
			...notMatching,
		});

		if (hit.isError || hit.rpcError || miss.isError || miss.rpcError) {
			return true;
		}

		return JSON.stringify(idsOf(hit)) === JSON.stringify(idsOf(miss));
	};

	it.fails("answers a where on the related user's email", async () => {
		expect(
			await independentOf(
				{ where: { "author.email": { equals: AUTHOR.email } } },
				{ where: { "author.email": { equals: "nobody@example.com" } } },
			),
		).toBe(true);
	});

	it.fails(
		"answers a where on whether the related user has an API key",
		async () => {
			expect(
				await independentOf(
					{ where: { "author.apiKey": { exists: true } } },
					{ where: { "author.apiKey": { exists: false } } },
				),
			).toBe(true);
		},
	);

	it.fails("orders by the related user's email", async () => {
		expect(
			await independentOf({ sort: "author.email" }, { sort: "-author.email" }),
		).toBe(true);
	});

	it("finds both articles without a filter", async () => {
		const all = await call("findDocuments", { collection: "articles" });

		expect(idsOf(all).sort()).toEqual([articleId, otherArticleId].sort());
	});
});
