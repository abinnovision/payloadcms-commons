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
	targetOf,
} from "./walk.js";
import { buildFixtureConfig } from "../../test/fixtures/config.js";
import { translatorFor } from "../i18n.js";

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
		expect(joinPath(["items", "*", "title"])).toBe("/items/*/title");
		expect(splitPath("/items/*/title")).toEqual(["items", "*", "title"]);
		expect(splitPath("/layout/sections")).toEqual(["layout", "sections"]);
	});

	it("treats no segments as the root", () => {
		expect(joinPath([])).toBe("");
		expect(splitPath("")).toEqual([]);
	});

	it("escapes segments that would otherwise split", () => {
		expect(joinPath(["a/b", "c~d"])).toBe("/a~1b/c~0d");
		expect(splitPath("/a~1b/c~0d")).toEqual(["a/b", "c~d"]);
	});
});

describe("describeFields", () => {
	it("flattens unnamed tabs and keeps named ones", () => {
		const paths = describeFields(pagesFields()).map((field) => field.path);

		expect(paths).toContain("/title");
		expect(paths).toContain("/slug");
		expect(paths).toContain("/layout/color");
		expect(paths).not.toContain("/General/title");
	});

	it("carries serializable admin descriptions and drops functions", () => {
		const descriptors = describeFields(pagesFields());
		const byPath = (path: string) =>
			descriptors.find((field) => field.path === path);

		expect(byPath("/slug")?.description).toBe(
			"URL segment of the page, lowercase.",
		);
		// No translator, so a locale record falls back to its first entry.
		expect(byPath("/title")?.description).toBe("Page title");
		expect(byPath("/meta/title")).not.toHaveProperty("description");
		expect(byPath("/layout/color")).not.toHaveProperty("description");
	});

	it("resolves a localized description for the request's language", () => {
		const titleFor = (language: string, fallbackLanguage: string) =>
			describeFields(
				pagesFields(),
				translatorFor({ fallbackLanguage, language }),
			).find((field) => field.path === "/title")?.description;

		expect(titleFor("de", "en")).toBe("Seitentitel");
		expect(titleFor("fr", "de")).toBe("Seitentitel");
		// Neither language is declared, so the first entry stands in.
		expect(titleFor("fr", "fr")).toBe("Page title");
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

		expect(paths).toEqual(["/meta/a", "/b", "/c", "/d"]);
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

		expect(paths).toEqual(["/visible"]);

		const fromConfig = describeFields(pagesFields()).map((field) => field.path);

		expect(fromConfig).not.toContain("/_status");
		expect(fromConfig).not.toContain("/id");
	});

	it("stops at a blocks field and names the slugs", () => {
		const sections = describeFields(pagesFields()).find(
			(field) => field.path === "/layout/sections",
		);

		expect(sections).toEqual({
			blocks: ["sectionWrapper", "richText"],
			path: "/layout/sections",
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
			{ path: "/items", type: "array" },
			{ localized: true, path: "/items/*/title", type: "text" },
		]);
	});

	it("reports what an array itself declares", () => {
		const fields: Field[] = [
			{
				name: "items",
				type: "array",
				required: true,
				minRows: 1,
				maxRows: 4,
				admin: { description: "Repeated content rows." },
				fields: [{ name: "title", type: "text" }],
			},
		];

		expect(describeFields(flattenAllFields({ fields }))[0]).toEqual({
			description: "Repeated content rows.",
			maxRows: 4,
			minRows: 1,
			path: "/items",
			required: true,
			type: "array",
		});
	});

	it("describes a group only when it declares something of its own", () => {
		const fields: Field[] = [
			{
				name: "bare",
				type: "group",
				fields: [{ name: "inner", type: "text" }],
			},
			{
				name: "described",
				type: "group",
				admin: { description: "Search engine metadata." },
				fields: [{ name: "inner", type: "text" }],
			},
		];

		expect(describeFields(flattenAllFields({ fields }))).toEqual([
			{ path: "/bare/inner", type: "text" },
			{
				description: "Search engine metadata.",
				path: "/described",
				type: "group",
			},
			{ path: "/described/inner", type: "text" },
		]);
	});

	it("reports length and range constraints on leaves", () => {
		const fields: Field[] = [
			{ name: "title", type: "text", maxLength: 120, minLength: 3 },
			{ name: "body", type: "textarea", maxLength: 256 },
			{ name: "weight", type: "number", min: 1, max: 10 },
			{ name: "loose", type: "text" },
		];

		expect(describeFields(flattenAllFields({ fields }))).toEqual([
			{ maxLength: 120, minLength: 3, path: "/title", type: "text" },
			{ maxLength: 256, path: "/body", type: "textarea" },
			{ max: 10, min: 1, path: "/weight", type: "number" },
			{ path: "/loose", type: "text" },
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
			{ options: ["light", "dark"], path: "/color", type: "select" },
			{ options: ["a"], path: "/mode", type: "radio" },
			{
				hasMany: true,
				path: "/tags",
				relationTo: "tags",
				type: "relationship",
			},
			{ path: "/any", relationTo: ["tags", "pages"], type: "relationship" },
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
			{ path: "/locked", readOnly: true, type: "text" },
			{ path: "/frozen/inner", readOnly: true, type: "text" },
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

describe("targetOf", () => {
	it("resolves a collection and a global from the same config", () => {
		expect(targetOf(config, { kind: "collection", slug: "pages" }).slug).toBe(
			"pages",
		);
		expect(
			targetOf(config, { kind: "global", slug: "site-settings" }).slug,
		).toBe("site-settings");
	});

	it("keeps the two namespaces apart in its error message", () => {
		expect(() => targetOf(config, { kind: "global", slug: "pages" })).toThrow(
			'Unknown global "pages".',
		);
		expect(() =>
			targetOf(config, { kind: "collection", slug: "site-settings" }),
		).toThrow('Unknown collection "site-settings".');
	});
});
