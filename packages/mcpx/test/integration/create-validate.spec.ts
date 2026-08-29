import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { callTool, collectionEnumOf, toolsList } from "./helpers/mcp.js";
import { bootPayload, hero, section, seedKeys } from "./helpers/payload.js";

import type { Booted, Seeded } from "./helpers/payload.js";

describe("createDocument and validateDocument", () => {
	let booted: Booted;
	let seeded: Seeded;

	beforeAll(async () => {
		booted = await bootPayload();
		seeded = await seedKeys(booted.payload);
	});

	afterAll(async () => {
		await booted.payload.destroy();
	});

	const call = (name: string, args: Record<string, unknown>) =>
		callTool(booted.config, seeded.keys.full, name, args);

	it("refuses a seed with an unknown field, listing the valid ones", async () => {
		const result = await call("createDocument", {
			collection: "pages",
			locale: "en",
			data: { titel: "Typo" },
		});

		expect(result.isError).toBe(true);
		const problems = JSON.stringify(result.data["problems"]);

		expect(problems).toContain("titel");
		expect(problems).toContain("title");
	});

	it("refuses a seed carrying a top-level id and creates nothing", async () => {
		const before = await booted.payload.count({ collection: "pages" });

		const result = await call("createDocument", {
			collection: "pages",
			locale: "en",
			data: { id: 999, title: "Numbered" },
		});

		expect(result.isError).toBe(true);
		expect(JSON.stringify(result.data["problems"])).toContain("/id");

		const after = await booted.payload.count({ collection: "pages" });

		expect(after.totalDocs).toBe(before.totalDocs);
	});

	it("creates a draft from a minimal seed and reports the blockers", async () => {
		const result = await call("createDocument", {
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
		const created = await call("createDocument", {
			collection: "pages",
			locale: "en",
			data: { title: "Converging" },
		});
		const id = created.data["id"] as number;

		const before = await call("validateDocument", {
			collection: "pages",
			id,
			locale: "en",
		});

		await call("patchDocument", {
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

		const after = await call("validateDocument", {
			collection: "pages",
			id,
			locale: "en",
		});

		expect(
			(before.data["publishBlockers"] as unknown[]).length,
		).toBeGreaterThan(0);
		expect(after.data["publishBlockers"]).toEqual([]);
	});

	it("keeps collections without write capability out of the write enums", async () => {
		const tools = await toolsList(booted.config, seeded.keys.full);

		for (const name of ["createDocument", "validateDocument"]) {
			expect(collectionEnumOf(tools.find((t) => t.name === name))).toEqual([
				"pages",
				"posts",
			]);
		}
	});
});
