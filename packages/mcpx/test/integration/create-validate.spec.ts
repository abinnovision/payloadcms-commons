import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { collectionEnumOf, createMcpClient } from "./helpers/mcp.js";
import { bootPayload, seedKeys, storedState } from "./helpers/payload.js";
import { hero, section } from "../builders/blocks.js";
import { bulletList } from "../builders/lexical.js";

import type { McpClient } from "./helpers/mcp.js";
import type { Booted } from "./helpers/payload.js";

describe("createDocument and validateDocument", () => {
	let booted: Booted;
	let mcp: McpClient;

	beforeAll(async () => {
		booted = await bootPayload();
		mcp = createMcpClient(booted, (await seedKeys(booted.payload)).keys.full);
	});

	afterAll(async () => {
		await booted.payload.destroy();
	});

	const storedPages = () =>
		storedState(booted.payload, { collections: ["pages"] });

	it("refuses a seed with an unknown field, listing the valid ones", async () => {
		const before = await storedPages();
		const result = await mcp.call("createDocument", {
			collection: "pages",
			locale: "en",
			data: { titel: "Typo" },
		});

		expect(result.isError).toBe(true);
		const problems = JSON.stringify(result.data["problems"]);

		expect(problems).toContain("titel");
		expect(problems).toContain("title");
		expect(await storedPages()).toEqual(before);
	});

	it("refuses a list node missing what the editor hydrates it from", async () => {
		const before = await booted.payload.count({ collection: "posts" });

		const result = await mcp.call("createDocument", {
			collection: "posts",
			locale: "en",
			data: {
				title: "Listed",
				content: bulletList("One", { stripIndent: true }),
			},
		});

		expect(result.isError).toBe(true);
		expect(result.data["problems"]).toEqual([
			'/content/root/children/0/children/0: a "listitem" node is missing "indent". Write nodes as Lexical serializes them.',
		]);

		const after = await booted.payload.count({ collection: "posts" });

		expect(after.totalDocs).toBe(before.totalDocs);

		const mistyped = await mcp.call("createDocument", {
			collection: "posts",
			locale: "en",
			data: { title: "Listed", content: bulletList("One", { indent: null }) },
		});

		expect(mistyped.isError).toBe(true);
		expect(mistyped.data["problems"]).toEqual([
			'/content/root/children/0/children/0/indent: a "listitem" node needs a number here.',
		]);

		const accepted = await mcp.call("createDocument", {
			collection: "posts",
			locale: "en",
			data: { title: "Listed", content: bulletList("One") },
		});

		expect(accepted.isError).toBe(false);
	});

	it("refuses a seed carrying a top-level id and creates nothing", async () => {
		const before = await storedPages();

		const result = await mcp.call("createDocument", {
			collection: "pages",
			locale: "en",
			data: { id: 999, title: "Numbered" },
		});

		expect(result.isError).toBe(true);
		expect(JSON.stringify(result.data["problems"])).toContain("/id");
		expect(await storedPages()).toEqual(before);
	});

	it("creates a draft from a minimal seed and reports the blockers", async () => {
		const result = await mcp.call("createDocument", {
			collection: "pages",
			locale: "en",
			data: { title: "Seeded" },
		});

		expect(result.isError).toBe(false);
		expect(result.data["status"]).toBe("draft");

		const blockers = result.data["publishBlockers"] as { path: string }[];

		expect(blockers.map((b) => b.path)).toEqual(
			expect.arrayContaining(["/slug", "/layout/sections"]),
		);
	});

	it("shrinks the blocker list as patches fill the draft", async () => {
		const created = await mcp.call("createDocument", {
			collection: "pages",
			locale: "en",
			data: { title: "Converging" },
		});
		const id = created.data["id"] as number;

		const before = await mcp.call("validateDocument", {
			collection: "pages",
			id,
			locale: "en",
		});

		await mcp.call("patchDocument", {
			collection: "pages",
			id,
			locale: "en",
			patches: [
				{ op: "replace", path: "/slug", value: "converging" },
				{
					op: "replace",
					path: "/layout/sections",
					value: [section("intro", [hero("Hello")])],
				},
			],
		});

		const after = await mcp.call("validateDocument", {
			collection: "pages",
			id,
			locale: "en",
		});

		expect(
			(before.data["publishBlockers"] as unknown[]).length,
		).toBeGreaterThan(0);
		expect(after.data["publishBlockers"]).toEqual([]);
	});

	it("checks every locale when none is given, tagging each blocker", async () => {
		const created = await mcp.call("createDocument", {
			collection: "pages",
			locale: "en",
			data: {
				title: "Seeded",
				slug: "seeded",
				layout: {
					sections: [{ blockType: "sectionWrapper", identifier: "seeded" }],
				},
			},
		});
		const result = await mcp.call("validateDocument", {
			collection: "pages",
			id: created.data["id"],
		});
		const blockers = result.data["publishBlockers"] as {
			locale: string;
			path: string;
		}[];

		expect(blockers.filter((b) => b.locale === "de")).toEqual([
			expect.objectContaining({ path: "/title" }),
		]);
		expect(blockers.filter((b) => b.locale === "en")).toEqual([]);
	});

	it("keeps collections without write capability out of the write enums", async () => {
		const tools = await mcp.list();

		for (const name of ["createDocument", "validateDocument"]) {
			expect(collectionEnumOf(tools.find((t) => t.name === name))).toEqual([
				"pages",
				"posts",
			]);
		}
	});
});
