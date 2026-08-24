import { flattenAllFields } from "payload";
import { beforeAll, describe, expect, it } from "vitest";

import { resolveDataPointer } from "./pointer.js";
import { validateWriteValue } from "./shape.js";
import { buildFixtureConfig } from "../../test/fixtures/config.js";

import type { Field, SanitizedConfig } from "payload";

let config: SanitizedConfig;

beforeAll(async () => {
	config = await buildFixtureConfig();
});

const DOC = {
	layout: {
		sections: [
			{ blockType: "sectionWrapper", modules: [{ blockType: "hero" }] },
		],
	},
	title: "Home",
};

const lexical = (type: string) => ({
	root: {
		children: [{ children: [{ text: "hi", type: "text" }], type }],
		type: "root",
	},
});

const POST = { content: { root: { children: [], type: "root" } } };

/** An editor state holding one node of `type`, carrying `fields`. */
const nodeState = (type: string, fields: unknown) => ({
	root: { children: [{ children: [], fields, type }], type: "root" },
});

const linkNode = (fields: unknown) => nodeState("link", fields);
const blockNode = (fields: unknown) => nodeState("block", fields);

const checkPost = (value: unknown) =>
	validateWriteValue(
		config,
		{
			pointer: "/content",
			resolution: resolveDataPointer(config, {
				addedValue: value,
				doc: POST,
				pointer: "/content",
				ref: { kind: "collection", slug: "posts" },
			}),
		},
		value,
	);

const check = (pointer: string, value: unknown) =>
	validateWriteValue(
		config,
		{
			pointer,
			resolution: resolveDataPointer(config, {
				addedValue: value,
				doc: DOC,
				pointer,
				ref: { kind: "collection", slug: "pages" },
			}),
		},
		value,
	);

describe("validateWriteValue", () => {
	it("accepts a well-formed section", () => {
		expect(
			check("/layout/sections/-", {
				blockType: "sectionWrapper",
				identifier: "intro",
				modules: [
					{
						blockType: "hero",
						id: "row-id",
						imageSize: "large",
						title: lexical("paragraph"),
					},
				],
			}),
		).toEqual([]);
	});

	it("rejects a misspelled field inside a new section, naming the siblings", () => {
		expect(
			check("/layout/sections/-", {
				blockType: "sectionWrapper",
				identifer: "intro",
			}),
		).toEqual([
			"/layout/sections/-/identifer: no such field. Available: identifier, modules",
		]);
	});

	it("rejects a block that is not allowed at the position", () => {
		expect(
			check("/layout/sections/0/modules", [{ blockType: "sectionWrapper" }]),
		).toEqual([
			'/layout/sections/0/modules/0: "sectionWrapper" is not allowed here. Allowed: hero, richText',
		]);
	});

	it("rejects a node the field's editor cannot produce", () => {
		expect(
			check("/layout/sections/0/modules", [
				{ blockType: "hero", title: lexical("heading") },
			]),
		).toEqual([
			'/layout/sections/0/modules/0/title/root/children/0: "heading" is not available in this field\'s editor. Allowed: root, paragraph, text, linebreak, tab',
		]);
		expect(check("/layout/sections/0/modules/0/title", "plain")).toEqual([
			'/layout/sections/0/modules/0/title: expected a Lexical editor state with a "root".',
		]);
	});

	it("checks the fields a Lexical node carries", () => {
		expect(
			checkPost(linkNode({ linkType: "custom", rel: "nofollow", url: "/x" })),
		).toEqual([]);
		expect(checkPost(linkNode({ relation: "nofollow", url: "/x" }))).toEqual([
			"/content/root/children/0/fields/relation: no such field. Available: linkType, url, doc, newTab, rel",
		]);
		expect(checkPost(linkNode("nope"))).toEqual([
			'/content/root/children/0: a "link" node carries a "fields" object.',
		]);
	});

	it("checks a Lexical block against the definition its slug names", () => {
		expect(
			checkPost(blockNode({ blockType: "callout", tone: "info" })),
		).toEqual([]);
		expect(checkPost(blockNode({ blockType: "badge", label: "new" }))).toEqual([
			'/content/root/children/0/fields: "badge" is not allowed here. Allowed: callout',
		]);
		expect(
			checkPost(blockNode({ blockType: "callout", tune: "info" })),
		).toEqual([
			"/content/root/children/0/fields/tune: no such field. Available: tone, note",
		]);
	});

	it("reports every problem rather than the first", () => {
		expect(
			check("/layout/sections/-", {
				blockType: "sectionWrapper",
				bogus: 1,
				modules: "not-an-array",
			}),
		).toEqual([
			"/layout/sections/-/bogus: no such field. Available: identifier, modules",
			"/layout/sections/-/modules: expected an array of blocks.",
		]);
	});

	it("refuses a write to a read-only field", () => {
		const fields: Field[] = [
			{ name: "locked", type: "text", admin: { readOnly: true } },
		];
		const flattened = flattenAllFields({ fields });

		expect(
			validateWriteValue(
				config,
				{ pointer: "", resolution: { fields: flattened, prefix: [] } },
				{ locked: "x" },
			),
		).toEqual(["/locked: this field is read-only and cannot be written."]);
	});

	it("validates a whole document at the root", () => {
		const resolution = {
			fields: config.collections.find((c) => c.slug === "pages")!
				.flattenedFields,
			prefix: [],
		};

		expect(
			validateWriteValue(
				config,
				{ pointer: "", resolution },
				{ title: "Home", layout: { colour: "light" } },
			),
		).toEqual(["/layout/colour: no such field. Available: color, sections"]);
	});
});
