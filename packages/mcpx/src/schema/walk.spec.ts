import { flattenAllFields } from "payload";
import { beforeAll, describe, expect, it } from "vitest";

import { allowedNodeTypes } from "./lexical.js";
import {
	blockOf,
	blockSlugsOf,
	describeFields,
	findBlocksField,
	joinPath,
	splitPath,
} from "./walk.js";
import { buildFixtureConfig } from "../../test/fixtures/config.js";

import type {
	Field,
	FlattenedBlocksField,
	RichTextField,
	SanitizedConfig,
} from "payload";

let config: SanitizedConfig;

beforeAll(async () => {
	config = await buildFixtureConfig();
});

const pagesFields = () =>
	config.collections.find((collection) => collection.slug === "pages")!
		.flattenedFields;

describe("path helpers", () => {
	it("round-trips array markers", () => {
		expect(joinPath(["items", "[]", "title"])).toBe("items[].title");
		expect(splitPath("items[].title")).toEqual(["items", "[]", "title"]);
		expect(splitPath("layout.sections")).toEqual(["layout", "sections"]);
	});
});

describe("describeFields", () => {
	it("flattens unnamed tabs and keeps named ones", () => {
		const paths = describeFields(pagesFields()).map((field) => field.path);

		expect(paths).toContain("title");
		expect(paths).toContain("slug");
		expect(paths).toContain("layout.color");
		expect(paths).not.toContain("General.title");
	});

	it("keeps named groups and flattens unnamed ones", () => {
		const fields: Field[] = [
			{ name: "meta", type: "group", fields: [{ name: "a", type: "text" }] },
			{
				type: "group",
				label: "Unnamed",
				fields: [{ name: "b", type: "text" }],
			},
			{ type: "row", fields: [{ name: "c", type: "text" }] },
			{
				type: "collapsible",
				label: "More",
				fields: [{ name: "d", type: "text" }],
			},
		];

		const paths = describeFields(flattenAllFields({ fields })).map(
			(field) => field.path,
		);

		expect(paths).toEqual(["meta.a", "b", "c", "d"]);
	});

	it("never describes reserved, join, virtual or hidden fields", () => {
		const fields: Field[] = [
			{ name: "id", type: "text" },
			{ name: "_status", type: "select", options: ["draft", "published"] },
			{ name: "createdAt", type: "date" },
			{ name: "updatedAt", type: "date" },
			{ name: "deletedAt", type: "date" },
			{ name: "secret", type: "text", hidden: true },
			{ name: "disabled", type: "text", admin: { disabled: true } },
			{ name: "computed", type: "text", virtual: true },
			{ name: "visible", type: "text" },
		];

		const paths = describeFields(flattenAllFields({ fields })).map(
			(field) => field.path,
		);

		expect(paths).toEqual(["visible"]);

		const fromConfig = describeFields(pagesFields()).map((field) => field.path);

		expect(fromConfig).not.toContain("_status");
		expect(fromConfig).not.toContain("id");
	});

	it("stops at a blocks field and names the slugs", () => {
		const sections = describeFields(pagesFields()).find(
			(field) => field.path === "layout.sections",
		);

		expect(sections).toEqual({
			blocks: ["sectionWrapper", "richText"],
			path: "layout.sections",
			required: true,
			type: "blocks",
		});
	});

	it("addresses array subfields with the marker", () => {
		const fields: Field[] = [
			{
				name: "items",
				type: "array",
				fields: [{ name: "title", type: "text", localized: true }],
			},
		];

		expect(describeFields(flattenAllFields({ fields }))).toEqual([
			{ localized: true, path: "items[].title", type: "text" },
		]);
	});

	it("reports options, relations and hasMany on leaves", () => {
		const fields: Field[] = [
			{ name: "color", type: "select", options: ["light", "dark"] },
			{
				name: "mode",
				type: "radio",
				options: [{ label: "A", value: "a" }],
			},
			{ name: "tags", type: "relationship", relationTo: "tags", hasMany: true },
			{ name: "any", type: "relationship", relationTo: ["tags", "pages"] },
		];

		expect(describeFields(flattenAllFields({ fields }))).toEqual([
			{ options: ["light", "dark"], path: "color", type: "select" },
			{ options: ["a"], path: "mode", type: "radio" },
			{ hasMany: true, path: "tags", relationTo: "tags", type: "relationship" },
			{ path: "any", relationTo: ["tags", "pages"], type: "relationship" },
		]);
	});

	it("marks read-only fields and propagates it to children", () => {
		const fields: Field[] = [
			{ name: "locked", type: "text", admin: { readOnly: true } },
			{
				name: "frozen",
				type: "group",
				admin: { readOnly: true },
				fields: [{ name: "inner", type: "text" }],
			},
		];

		expect(describeFields(flattenAllFields({ fields }))).toEqual([
			{ path: "locked", readOnly: true, type: "text" },
			{ path: "frozen.inner", readOnly: true, type: "text" },
		]);
	});
});

describe("blocks helpers", () => {
	const sectionsField = () =>
		findBlocksField(pagesFields(), ["layout", "sections"])!;

	it("finds a blocks field through a named tab", () => {
		expect(sectionsField()).toMatchObject({ name: "sections", type: "blocks" });
		expect(findBlocksField(pagesFields(), ["layout", "color"])).toBeUndefined();
	});

	it("lists slugs from references and inline definitions alike", () => {
		expect(blockSlugsOf(sectionsField())).toEqual([
			"sectionWrapper",
			"richText",
		]);
	});

	it("resolves an inline block before the registry and a reference through it", () => {
		const wrapper = blockOf(config, sectionsField(), "sectionWrapper");
		const modules = wrapper?.flattenedFields.find(
			(field) => field.type === "blocks",
		);

		expect(wrapper?.slug).toBe("sectionWrapper");
		expect(modules && blockSlugsOf(modules)).toEqual(["hero", "richText"]);
		expect(modules && blockOf(config, modules, "richText")?.slug).toBe(
			"richText",
		);
		expect(modules && blockOf(config, modules, "hero")?.slug).toBe("hero");
		expect(modules && blockOf(config, modules, "other")).toBeUndefined();
	});
});

describe("allowedNodeTypes", () => {
	it("reports the nodes a field's editor enables", () => {
		const sections = findBlocksField(pagesFields(), ["layout", "sections"])!;
		const wrapper = blockOf(config, sections, "sectionWrapper")!;
		const modules = wrapper.flattenedFields.find(
			(field) => field.type === "blocks",
		) as FlattenedBlocksField;
		const hero = blockOf(config, modules, "hero")!;

		const title = hero.flattenedFields.find(
			(field) => "name" in field && field.name === "title",
		) as RichTextField;
		const body = hero.flattenedFields.find(
			(field) => "name" in field && field.name === "body",
		) as RichTextField;

		expect(allowedNodeTypes(title)).not.toContain("heading");
		expect(allowedNodeTypes(title)).toContain("paragraph");
		expect(allowedNodeTypes(body)).toContain("heading");
		expect(allowedNodeTypes(body)).toContain("link");
	});

	it("falls back to the core nodes for unknown editors", () => {
		expect(allowedNodeTypes({ name: "x", type: "richText" })).toEqual([
			"root",
			"paragraph",
			"text",
			"linebreak",
			"tab",
		]);
	});
});
