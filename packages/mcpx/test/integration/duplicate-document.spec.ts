import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { collectionEnumOf, createMcpClient } from "./helpers/mcp.js";
import { bootPayload, seedKeysFor, storedState } from "./helpers/payload.js";

import type { McpClient } from "./helpers/mcp.js";
import type { Booted } from "./helpers/payload.js";
import type { CollectionConfig } from "payload";

const CACHE_KEY = "mcpx-duplicate-document";

/*
 * Drafts, a localized title, a unique code and a required summary. Its users
 * read every document except the one coded "secret".
 */
const handbooks: CollectionConfig = {
	slug: "handbooks",
	versions: { drafts: true },
	access: {
		read: ({ req }) => (req.user ? { code: { not_equals: "secret" } } : false),
	},
	fields: [
		{ name: "title", type: "text", localized: true },
		{ name: "code", type: "text", unique: true },
		{ name: "summary", type: "text", required: true },
	],
};

const stamps: CollectionConfig = {
	slug: "stamps",
	disableDuplicate: true,
	fields: [{ name: "title", type: "text" }],
};

describe("duplicateDocument", () => {
	let booted: Booted;
	let mcp: McpClient;

	beforeAll(async () => {
		booted = await bootPayload({
			key: CACHE_KEY,
			collections: [handbooks, stamps],
			plugin: {
				collections: { handbooks: true, stamps: true, media: true, tags: true },
			},
		});

		const { keys } = await seedKeysFor(booted.payload, {
			editor: {
				collections: {
					handbooks: { read: true, write: true },
					stamps: { read: true, write: true },
					media: { read: true, write: true },
					tags: { read: true },
				},
			},
		});

		mcp = createMcpClient(booted, keys.editor);
	});

	afterAll(async () => {
		await booted.payload.destroy();
	});

	const seedHandbook = async (code: string): Promise<number | string> => {
		const { payload } = booted;
		const doc = await payload.create({
			collection: "handbooks" as never,
			locale: "en",
			draft: true,
			data: { title: "Guide", code },
		});

		await payload.update({
			collection: "handbooks" as never,
			id: doc.id,
			locale: "de",
			draft: true,
			data: { title: "Leitfaden" },
		});

		return doc.id;
	};

	const readAll = (id: number | string) =>
		booted.payload.findByID({
			collection: "handbooks" as never,
			id,
			depth: 0,
			draft: true,
			locale: "all",
			overrideAccess: true,
		}) as unknown as Promise<Record<string, unknown>>;

	it("copies a draft in every locale and leaves the source untouched", async () => {
		const id = await seedHandbook("guide");
		const before = await readAll(id);

		const result = await mcp.call("duplicateDocument", {
			collection: "handbooks",
			id,
		});

		expect(result.isError).toBe(false);
		expect(result.data["id"]).not.toBe(id);
		expect(result.data["status"]).toBe("draft");
		expect(result.data["publishBlockers"]).toEqual([
			expect.objectContaining({ path: "/summary" }),
		]);

		const copy = await readAll(result.data["id"] as number | string);

		expect(copy["title"]).toEqual({ en: "Guide", de: "Leitfaden" });
		expect(copy["code"]).toBe("guide - Copy");
		expect(await readAll(id)).toEqual(before);
	});

	it("refuses a source the user cannot read and writes nothing", async () => {
		const id = await seedHandbook("secret");
		const before = await storedState(booted.payload, {
			collections: ["handbooks"],
		});

		const result = await mcp.call("duplicateDocument", {
			collection: "handbooks",
			id,
		});

		expect(result.isError).toBe(true);
		expect(
			await storedState(booted.payload, { collections: ["handbooks"] }),
		).toEqual(before);
	});

	it("refuses a collection outside the key's write scope", async () => {
		const tag = await booted.payload.create({
			collection: "tags",
			data: { name: "News" },
		});
		const before = await booted.payload.count({ collection: "tags" });

		const result = await mcp.call("duplicateDocument", {
			collection: "tags",
			id: tag.id,
		});

		expect(result.isError).toBe(true);
		expect(await booted.payload.count({ collection: "tags" })).toEqual(before);
	});

	it("leaves upload and disableDuplicate collections out of its enum", async () => {
		const tools = await mcp.list();

		expect(
			collectionEnumOf(tools.find((t) => t.name === "createDocument")),
		).toEqual(expect.arrayContaining(["media", "stamps"]));
		expect(
			collectionEnumOf(tools.find((t) => t.name === "duplicateDocument")),
		).toEqual(["handbooks"]);
	});
});
