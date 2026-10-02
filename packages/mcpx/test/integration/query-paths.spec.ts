import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMcpClient } from "./helpers/mcp.js";
import { bootPayload, seedKeysFor } from "./helpers/payload.js";
import {
	apiKeyUsers,
	articles,
	dispatches,
	remarks,
} from "../fixtures/security.js";

import type { CallResult, McpClient } from "./helpers/mcp.js";
import type { Booted } from "./helpers/payload.js";

const CACHE_KEY = "mcpx-integration-query-paths";

const AUTHOR_EMAIL = "query-author@example.com";

/**
 * A where or sort through a relation reads the related document, so a key may
 * not use one that leads into a collection it cannot read. Naming the relation
 * itself, or going through a collection the key can read, stays allowed.
 */
describe("findDocuments where and sort through relations", () => {
	let booted: Booted;
	let wide: McpClient;
	let narrow: McpClient;
	let authorId: number | string;
	let articleId: number | string;
	let dispatchId: number | string;
	let remarkId: number | string;

	beforeAll(async () => {
		booted = await bootPayload({
			key: CACHE_KEY,
			users: apiKeyUsers,
			collections: [articles, dispatches, remarks],
			plugin: { collections: { articles: true, dispatches: true } },
		});

		const { payload } = booted;
		const author = await payload.create({
			collection: "users",
			data: { email: AUTHOR_EMAIL, password: "author-secret" },
		});
		const article = await payload.create({
			collection: "articles" as never,
			data: { title: "Readable", author: author.id },
		});
		const dispatch = await payload.create({
			collection: "dispatches" as never,
			data: {
				title: "Dispatch",
				reviewers: [author.id],
				subjects: [{ relationTo: "users", value: author.id }],
				article: article.id,
				meta: { owner: author.id },
				entries: [{ person: author.id }],
				sections: [{ blockType: "mention", person: author.id }],
			},
		});

		authorId = author.id;
		articleId = article.id;
		dispatchId = dispatch.id;

		const remark = await payload.create({
			collection: "remarks" as never,
			data: { text: "Remark", dispatch: dispatch.id },
		});

		remarkId = remark.id;

		const { keys } = await seedKeysFor(payload, {
			wide: {
				collections: { articles: { read: true }, dispatches: { read: true } },
			},
			narrow: { collections: { dispatches: { read: true } } },
		});

		wide = createMcpClient(booted, keys.wide);
		narrow = createMcpClient(booted, keys.narrow);
	});

	afterAll(async () => {
		await booted.payload.destroy();
	});

	const find = (
		mcp: McpClient,
		collection: string,
		args: Record<string, unknown>,
	): Promise<CallResult> => mcp.call("findDocuments", { collection, ...args });

	const idsOf = (result: CallResult): unknown[] =>
		((result.data["docs"] as { id: unknown }[] | undefined) ?? []).map(
			(doc) => doc.id,
		);

	const refusal = (path: string) => ({
		error: `This key cannot query through "${path}".`,
		status: 400,
	});

	const nothing = { equals: "nobody@example.com" };

	describe("into a collection the key cannot read", () => {
		const wheres: [string, Record<string, unknown>, string][] = [
			[
				"a relationship",
				{ "article.author.email": nothing },
				"article.author.email",
			],
			[
				"a hasMany relationship",
				{ "reviewers.email": nothing },
				"reviewers.email",
			],
			[
				"a relationship in a group",
				{ "meta.owner.email": nothing },
				"meta.owner.email",
			],
			[
				"a relationship in an array",
				{ "entries.person.email": nothing },
				"entries.person.email",
			],
			[
				"a relationship in a block",
				{ "sections.person.email": nothing },
				"sections.person.email",
			],
			[
				"the double underscore form",
				{ meta__owner__email: nothing },
				"meta__owner__email",
			],
			[
				"a nested or",
				{ or: [{ and: [{ "meta.owner.email": nothing }] }] },
				"meta.owner.email",
			],
			[
				"an upper case OR",
				{ OR: [{ "meta.owner.email": nothing }] },
				"meta.owner.email",
			],
			["a join", { "remarks.text": { equals: "Remark" } }, "remarks.text"],
		];

		for (const [name, where, refused] of wheres) {
			it(`refuses a where through ${name}`, async () => {
				expect((await find(wide, "dispatches", { where })).data).toEqual(
					refusal(refused),
				);
			});
		}

		it("names the path it refuses", async () => {
			expect(
				(
					await find(wide, "dispatches", {
						where: { "meta.owner.email": nothing },
					})
				).data,
			).toEqual(refusal("meta.owner.email"));
		});

		const sorts: [string, string][] = [
			["meta.owner.email", "meta.owner.email"],
			["-meta.owner.email", "meta.owner.email"],
			["title,-meta.owner.email", "meta.owner.email"],
		];

		for (const [sort, path] of sorts) {
			it(`refuses sort "${sort}"`, async () => {
				expect((await find(wide, "dispatches", { sort })).data).toEqual(
					refusal(path),
				);
			});
		}

		it("refuses a sort that reaches a virtual field through a json field", async () => {
			expect(
				(await find(wide, "articles", { sort: "notes.authorEmail" })).data,
			).toEqual(refusal("notes.authorEmail"));
			expect(
				(await find(wide, "articles", { sort: "-notes.authorEmail" })).data,
			).toEqual(refusal("notes.authorEmail"));
		});

		it("refuses a sort that reaches a virtual field through a readable relation", async () => {
			expect(
				(await find(wide, "dispatches", { sort: "-article.ownerEmail" })).data,
			).toEqual(refusal("article.ownerEmail"));
		});

		it("refuses a virtual field that resolves through the relation", async () => {
			expect(
				(await find(wide, "articles", { where: { authorEmail: nothing } }))
					.data,
			).toEqual(refusal("authorEmail"));
			expect(
				(await find(wide, "articles", { sort: "-authorEmail" })).data,
			).toEqual(refusal("authorEmail"));
		});
	});

	describe("that stays allowed", () => {
		it("filters on the relation itself", async () => {
			const result = await find(wide, "articles", {
				where: { author: { equals: authorId } },
			});

			expect(idsOf(result)).toEqual([articleId]);
		});

		it("filters on the id of the relation", async () => {
			const result = await find(wide, "articles", {
				where: { "author.id": { equals: authorId } },
			});

			expect(idsOf(result)).toEqual([articleId]);
		});

		it("filters on the id of a group relation", async () => {
			const result = await find(wide, "dispatches", {
				where: { "meta.owner.id": { equals: authorId } },
			});

			expect(idsOf(result)).toEqual([dispatchId]);
		});

		it("leaves a filter on the id of a join to Payload", async () => {
			for (const path of ["remarks", "remarks.id"]) {
				const { data } = await find(wide, "dispatches", {
					where: { [path]: { equals: remarkId } },
				});

				expect(data).not.toEqual(refusal(path));
			}
		});

		it("filters on the value and the collection of a polymorphic relation", async () => {
			const result = await find(wide, "dispatches", {
				where: {
					and: [
						{ "subjects.value": { equals: authorId } },
						{ "subjects.relationTo": { equals: "users" } },
					],
				},
			});

			expect(idsOf(result)).toEqual([dispatchId]);
		});

		it("sorts on the relation itself", async () => {
			const result = await find(wide, "articles", { sort: "-author" });

			expect(result.isError).toBe(false);
		});
	});

	describe("into a collection the key can read", () => {
		it("filters on a field of the related document", async () => {
			const result = await find(wide, "dispatches", {
				where: { "article.title": { equals: "Readable" } },
			});

			expect(idsOf(result)).toEqual([dispatchId]);
		});

		it("sorts on a field of the related document", async () => {
			const result = await find(wide, "dispatches", { sort: "-article.title" });

			expect(result.isError).toBe(false);
		});
	});

	describe("with the related collection exposed to one key only", () => {
		const where = { "article.title": { equals: "Readable" } };

		it("answers the key that can read it", async () => {
			expect(idsOf(await find(wide, "dispatches", { where }))).toEqual([
				dispatchId,
			]);
		});

		it("refuses the key that cannot", async () => {
			expect((await find(narrow, "dispatches", { where })).data).toEqual(
				refusal("article.title"),
			);
			expect(
				(await find(narrow, "dispatches", { sort: "article.title" })).data,
			).toEqual(refusal("article.title"));
		});
	});
});
