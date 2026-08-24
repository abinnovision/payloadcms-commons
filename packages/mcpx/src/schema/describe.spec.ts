import { beforeAll, describe, expect, it } from "vitest";

import { describeNode, reachableSchemaPaths } from "./describe.js";
import { buildFixtureConfig } from "../../test/fixtures/config.js";

import type { SanitizedConfig } from "payload";

const SECTION_WRAPPER = "layout.sections.sectionWrapper";
const HERO = `${SECTION_WRAPPER}.modules.hero`;

const PAGES_REF = { kind: "collection", slug: "pages" } as const;
const SETTINGS_REF = { kind: "global", slug: "site-settings" } as const;

let config: SanitizedConfig;

beforeAll(async () => {
	config = await buildFixtureConfig();
});

describe("describeNode", () => {
	it("describes the collection root", () => {
		const node = describeNode(config, PAGES_REF);

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

	it("lists ready-to-use drill-down paths in next", () => {
		expect(describeNode(config, PAGES_REF).next).toEqual([
			SECTION_WRAPPER,
			"layout.sections.richText",
		]);
		expect(describeNode(config, PAGES_REF, SECTION_WRAPPER).next).toEqual([
			HERO,
			`${SECTION_WRAPPER}.modules.richText`,
		]);
		expect(describeNode(config, PAGES_REF, HERO).next).toBeUndefined();
	});

	it("resolves a block in the context of its host", () => {
		const node = describeNode(config, PAGES_REF, SECTION_WRAPPER);

		expect(node.blockType).toBe("sectionWrapper");
		expect(node.fields).toEqual([
			{ path: "identifier", type: "text" },
			{ blocks: ["hero", "richText"], path: "modules", type: "blocks" },
		]);
	});

	it("reaches a nested block through references and inline definitions", () => {
		const hero = describeNode(config, PAGES_REF, HERO);
		const richText = describeNode(
			config,
			PAGES_REF,
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
		const fields = describeNode(config, PAGES_REF, HERO).fields;
		const title = fields.find((field) => field.path === "title");
		const body = fields.find((field) => field.path === "body");

		expect(title?.nodes).not.toContain("heading");
		expect(body?.nodes).toContain("heading");
	});

	it("never inlines a block body", () => {
		const json = JSON.stringify(describeNode(config, PAGES_REF));

		expect(json).not.toContain("identifier");
		expect(json).not.toContain("imageSize");
	});

	it("rejects a block that is not allowed at the path", () => {
		expect(() =>
			describeNode(config, PAGES_REF, "layout.sections.hero"),
		).toThrow(
			'"hero" is not allowed at "layout.sections". Allowed: sectionWrapper, richText',
		);
	});

	it("lists the blocks fields when the path does not address one", () => {
		expect(() => describeNode(config, PAGES_REF, "title")).toThrow(
			'"title" does not address a blocks field. Blocks fields here: layout.sections',
		);
	});

	it("asks for a slug when the path stops at a blocks field", () => {
		expect(() => describeNode(config, PAGES_REF, "layout.sections")).toThrow(
			'"layout.sections" is a blocks field; append one of: sectionWrapper, richText',
		);
	});

	it("rejects an unknown collection", () => {
		expect(() =>
			describeNode(config, { kind: "collection", slug: "nope" }),
		).toThrow('Unknown collection "nope".');
	});
});

describe("reachableSchemaPaths", () => {
	it("visits every node once and stays cycle-safe", () => {
		expect(reachableSchemaPaths(config, PAGES_REF)).toEqual({
			paths: [
				"",
				SECTION_WRAPPER,
				HERO,
				`${SECTION_WRAPPER}.modules.richText`,
				"layout.sections.richText",
			],
			truncated: false,
		});
	});

	it("keeps the whole reachable graph within a context budget", () => {
		const bytes = reachableSchemaPaths(config, PAGES_REF)
			.paths.map(
				(schemaPath) =>
					JSON.stringify(describeNode(config, PAGES_REF, schemaPath)).length,
			)
			.reduce((sum, size) => sum + size, 0);

		expect(bytes).toBeLessThan(4_000);
	});

	it("matches the committed shape of the busiest nodes", async () => {
		const nodes = ["", SECTION_WRAPPER, HERO].map((schemaPath) =>
			describeNode(config, PAGES_REF, schemaPath),
		);

		await expect(`${JSON.stringify(nodes, null, "\t")}\n`).toMatchFileSnapshot(
			"./__snapshots__/describe.nodes.snap",
		);
	});
});

describe("describeNode for a global", () => {
	it("keys the node on global rather than collection", () => {
		const node = describeNode(config, SETTINGS_REF);

		expect(node.global).toBe("site-settings");
		expect(node.collection).toBeUndefined();
		expect(node.fields.map((field) => field.path)).toEqual([
			"title",
			"tagline",
			"sections",
		]);
	});

	it("descends into a block reached through a global", () => {
		const node = describeNode(config, SETTINGS_REF, "sections.sectionWrapper");

		expect(node.blockType).toBe("sectionWrapper");
		expect(node.global).toBe("site-settings");
	});

	it("walks every path reachable from a global root", () => {
		const { paths, truncated } = reachableSchemaPaths(config, SETTINGS_REF);

		expect(truncated).toBe(false);
		expect(paths).toContain("");
		expect(paths).toContain("sections.sectionWrapper");
	});
});
