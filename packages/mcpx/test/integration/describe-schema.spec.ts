import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { callTool } from "./helpers/mcp.js";
import { bootPayload, seedKeys } from "./helpers/payload.js";
import { reachableSchemaPaths } from "../../src/schema/describe.js";

import type { Booted, Seeded } from "./helpers/payload.js";

interface Node {
	collection: string;
	schemaPath: string;
	blockType?: string;
	fields: { path: string; type: string; blocks?: string[] }[];
	next?: string[];
	error?: string;
}

const nodes = (data: Record<string, unknown>): Node[] =>
	(Array.isArray(data) ? data : []) as Node[];

describe("describeSchema", () => {
	let booted: Booted;
	let seeded: Seeded;

	beforeAll(async () => {
		booted = await bootPayload();
		seeded = await seedKeys(booted.payload);
	});

	afterAll(async () => {
		await booted.payload.destroy();
	});

	const describe_ = (args: Record<string, unknown>) =>
		callTool(booted.config, seeded.keys.full, "describeSchema", args);

	it("describes the collection root without nesting blocks", async () => {
		const result = await describe_({ collection: "pages" });
		const [root] = nodes(result.data);

		expect(result.isError).toBe(false);
		expect(root?.schemaPath).toBe("");
		expect(root?.fields.map((f) => f.path)).toEqual([
			"/title",
			"/slug",
			"/layout/color",
			"/layout/sections",
			"/meta/title",
		]);
		expect(
			root?.fields.find((f) => f.path === "/layout/sections")?.blocks,
		).toEqual(["sectionWrapper", "richText"]);
		expect(root?.next).toEqual([
			"/layout/sections/sectionWrapper",
			"/layout/sections/richText",
		]);
		expect(JSON.stringify(root)).not.toContain("identifier");
	});

	it("rejects an unknown argument by name", async () => {
		const result = await describe_({
			collection: "pages",
			schemaPath: "/layout/sections/sectionWrapper",
		});

		expect(result.isError).toBe(true);
		expect(result.text).toMatch(/unrecognized|schemaPath/i);
	});

	it("describes a block in the context of its position", async () => {
		const result = await describe_({
			collection: "pages",
			paths: ["/layout/sections/sectionWrapper"],
		});
		const [node] = nodes(result.data);

		expect(node?.blockType).toBe("sectionWrapper");
		expect(node?.fields.map((f) => f.path)).toEqual([
			"/identifier",
			"/modules",
		]);
		expect(node?.fields.find((f) => f.path === "/modules")?.blocks).toEqual([
			"hero",
			"richText",
		]);
	});

	it("expands to every reachable node", async () => {
		const result = await describe_({ collection: "pages", expand: true });
		const config = await booted.config;

		expect(nodes(result.data).map((n) => n.schemaPath)).toEqual(
			reachableSchemaPaths(config, { kind: "collection", slug: "pages" }).paths,
		);
	});

	it("reports an unresolvable path per node", async () => {
		const result = await describe_({
			collection: "pages",
			paths: ["", "/layout/sections/carousel"],
		});
		const [root, bad] = nodes(result.data);

		expect(root?.fields.length).toBeGreaterThan(0);
		expect(bad?.error).toContain("carousel");
		expect(bad?.error).toContain("sectionWrapper");
	});

	it("drills into the fields a Lexical node carries", async () => {
		const root = nodes((await describe_({ collection: "posts" })).data)[0];

		expect(root?.next).toContain("/content/link");
		expect(root?.next).toContain("/content/block/callout");

		const link = nodes(
			(await describe_({ collection: "posts", paths: ["/content/link"] })).data,
		)[0];

		expect(link?.fields.map((f) => f.path)).toContain("/rel");
	});
});
