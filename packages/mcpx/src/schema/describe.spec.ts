import { beforeAll, describe, expect, it } from "vitest";

import { describeNode, reachableSchemaPaths } from "./describe.js";
import { buildFixtureConfig } from "../../test/fixtures/config.js";

import type { SanitizedConfig } from "payload";

const SECTION_WRAPPER = "layout.sections.sectionWrapper";
const HERO = `${SECTION_WRAPPER}.modules.hero`;

let config: SanitizedConfig;

beforeAll(async () => {
	config = await buildFixtureConfig();
});

describe("describeNode", () => {
	it("describes the collection root", () => {
		const node = describeNode(config, "pages");

		expect(node.schemaPath).toBe("");
		expect(node.blockType).toBeUndefined();
		expect(node.fields.map((field) => field.path)).toEqual([
			"title",
			"slug",
			"layout.color",
			"layout.sections",
			"meta.title",
		]);
	});

	it("resolves a block in the context of its host", () => {
		const node = describeNode(config, "pages", SECTION_WRAPPER);

		expect(node.blockType).toBe("sectionWrapper");
		expect(node.fields).toEqual([
			{ path: "identifier", type: "text" },
			{ blocks: ["hero", "richText"], path: "modules", type: "blocks" },
		]);
	});

	it("reaches a nested block through references and inline definitions", () => {
		const hero = describeNode(config, "pages", HERO);
		const richText = describeNode(
			config,
			"pages",
			`${SECTION_WRAPPER}.modules.richText`,
		);

		expect(hero.blockType).toBe("hero");
		expect(hero.fields.map((field) => field.path)).toEqual([
			"title",
			"body",
			"imageSize",
		]);
		expect(richText.fields).toEqual([
			{
				nodes: expect.arrayContaining(["paragraph", "heading"]),
				path: "content",
				required: true,
				type: "richText",
			},
		]);
	});

	it("reports rich text node types per field", () => {
		const fields = describeNode(config, "pages", HERO).fields;
		const title = fields.find((field) => field.path === "title");
		const body = fields.find((field) => field.path === "body");

		expect(title?.nodes).not.toContain("heading");
		expect(body?.nodes).toContain("heading");
	});

	it("never inlines a block body", () => {
		const json = JSON.stringify(describeNode(config, "pages"));

		expect(json).not.toContain("identifier");
		expect(json).not.toContain("imageSize");
	});

	it("rejects a block that is not allowed at the path", () => {
		expect(() => describeNode(config, "pages", "layout.sections.hero")).toThrow(
			'"hero" is not allowed at "layout.sections". Allowed: sectionWrapper, richText',
		);
	});

	it("lists the blocks fields when the path does not address one", () => {
		expect(() => describeNode(config, "pages", "title")).toThrow(
			'"title" does not address a blocks field. Blocks fields here: layout.sections',
		);
	});

	it("asks for a slug when the path stops at a blocks field", () => {
		expect(() => describeNode(config, "pages", "layout.sections")).toThrow(
			'"layout.sections" is a blocks field; append one of: sectionWrapper, richText',
		);
	});

	it("rejects an unknown collection", () => {
		expect(() => describeNode(config, "nope")).toThrow(
			'Unknown collection "nope".',
		);
	});
});

describe("reachableSchemaPaths", () => {
	it("visits every node once and stays cycle-safe", () => {
		expect(reachableSchemaPaths(config, "pages")).toEqual([
			"",
			SECTION_WRAPPER,
			HERO,
			`${SECTION_WRAPPER}.modules.richText`,
			"layout.sections.richText",
		]);
	});

	it("keeps the whole reachable graph within a context budget", () => {
		const bytes = reachableSchemaPaths(config, "pages")
			.map(
				(schemaPath) =>
					JSON.stringify(describeNode(config, "pages", schemaPath)).length,
			)
			.reduce((sum, size) => sum + size, 0);

		expect(bytes).toBeLessThan(4_000);
	});

	it("matches the committed shape of the busiest nodes", async () => {
		const nodes = ["", SECTION_WRAPPER, HERO].map((schemaPath) =>
			describeNode(config, "pages", schemaPath),
		);

		await expect(`${JSON.stringify(nodes, null, "\t")}\n`).toMatchFileSnapshot(
			"./__snapshots__/describe.nodes.snap",
		);
	});
});
