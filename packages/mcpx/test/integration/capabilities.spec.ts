import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
	callTool,
	collectionEnumOf,
	toolNames,
	toolsList,
} from "./helpers/mcp.js";
import { bootPayload, seedKeys } from "./helpers/payload.js";

import type { Booted, Seeded } from "./helpers/payload.js";

const BUILTIN = [
	"listCapabilities",
	"describeSchema",
	"findDocuments",
	"getDocument",
	"patchDocument",
	"createDocument",
	"validateDocument",
];

const WRITE_TOOLS = ["patchDocument", "createDocument", "validateDocument"];

describe("capabilities", () => {
	let booted: Booted;
	let seeded: Seeded;

	beforeAll(async () => {
		booted = await bootPayload();
		seeded = await seedKeys(booted.payload);
	});

	afterAll(async () => {
		await booted.payload.destroy();
	});

	it("lists every builtin tool plus the enabled custom tool for a full key", async () => {
		const names = await toolNames(booted.config, seeded.keys.full);

		expect(names).toEqual([...BUILTIN, "echo"]);
	});

	it("hides the write tools and the custom tool from a read-only key", async () => {
		const names = await toolNames(booted.config, seeded.keys.readOnly);

		expect(names).toEqual(BUILTIN.filter((n) => !WRITE_TOOLS.includes(n)));
	});

	it("narrows the collection enums to what the key may reach", async () => {
		const full = await toolsList(booted.config, seeded.keys.full);
		const tagsOnly = await toolsList(booted.config, seeded.keys.tagsOnly);

		expect(
			collectionEnumOf(full.find((t) => t.name === "findDocuments")),
		).toEqual(["pages", "posts", "tags"]);
		expect(
			collectionEnumOf(full.find((t) => t.name === "patchDocument")),
		).toEqual(["pages", "posts"]);
		expect(
			collectionEnumOf(tagsOnly.find((t) => t.name === "findDocuments")),
		).toEqual(["tags"]);
		expect(tagsOnly.map((t) => t.name)).not.toContain("patchDocument");
	});

	it("reports the key's capabilities in listCapabilities", async () => {
		const full = await callTool(
			booted.config,
			seeded.keys.full,
			"listCapabilities",
		);
		const readOnly = await callTool(
			booted.config,
			seeded.keys.readOnly,
			"listCapabilities",
		);

		expect(full.isError).toBe(false);
		expect(full.data["collections"]).toEqual([
			expect.objectContaining({
				slug: "pages",
				description: "Marketing pages rendered on the public site.",
				read: true,
				write: true,
				drafts: true,
				draftValidation: false,
				idType: "number",
			}),
			expect.objectContaining({ slug: "posts", read: true, write: true }),
			expect.objectContaining({ slug: "tags", read: true, write: false }),
		]);
		expect(full.data["locales"]).toEqual({
			codes: ["en", "de"],
			default: "en",
		});
		expect(full.data["limits"]).toEqual({ maxLimit: 25, maxDepth: 1 });
		expect(full.data["tools"]).toEqual(["echo"]);

		expect(readOnly.data["tools"]).toEqual([]);
		expect(readOnly.data["collections"]).toEqual([
			expect.objectContaining({ slug: "pages", write: false }),
			expect.objectContaining({ slug: "posts", write: false }),
			expect.objectContaining({ slug: "tags", write: false }),
		]);
	});

	it("refuses a collection outside the key's enum", async () => {
		const result = await callTool(
			booted.config,
			seeded.keys.tagsOnly,
			"findDocuments",
			{ collection: "pages" },
		);

		expect(result.isError).toBe(true);
		expect(result.text).toMatch(/validation|invalid/i);
	});

	it("refuses a write tool for a key without write capability", async () => {
		const result = await callTool(
			booted.config,
			seeded.keys.readOnly,
			"patchDocument",
			{
				collection: "pages",
				id: 1,
				locale: "en",
				patches: [{ op: "replace", path: "/title", value: "x" }],
			},
		);

		expect(result.isError).toBe(true);
	});
});
