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

const textNode = (value: string) => ({
	detail: 0,
	format: 0,
	mode: "normal",
	style: "",
	text: value,
	type: "text",
	version: 1,
});

/** As Lexical serializes it, so only what a case is about is ever missing. */
const node = (
	type: string,
	extra: Record<string, unknown> = {},
	children: unknown[] = [],
) => ({
	children,
	direction: "ltr",
	format: "",
	indent: 0,
	type,
	version: 1,
	...extra,
});

const state = (children: unknown[]) => ({
	root: {
		children,
		direction: "ltr",
		format: "",
		indent: 0,
		type: "root",
		version: 1,
	},
});

const lexical = (type: string) => state([node(type, {}, [textNode("hi")])]);

const POST = { content: { root: { children: [], type: "root" } } };

/** An editor state holding one node of `type`, carrying `fields`. */
const nodeState = (type: string, fields: unknown) =>
	state([node(type, { fields })]);

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

	it("rejects a node property the field's editor narrows", () => {
		const heading = (tag: string) => state([node("heading", { tag })]);
		const summary = (value: unknown) =>
			validateWriteValue(
				config,
				{
					pointer: "/summary",
					resolution: resolveDataPointer(config, {
						addedValue: value,
						doc: POST,
						pointer: "/summary",
						ref: { kind: "collection", slug: "posts" },
					}),
				},
				value,
			);

		expect(summary(heading("h4"))).toEqual([]);
		expect(summary(heading("h3"))).toEqual([
			'/summary/root/children/0/tag: "h3" is not available for a "heading" node in this field\'s editor. Allowed: h4',
		]);

		/* A value of the wrong kind used to skip the check and reach the document. */
		expect(summary(state([node("heading", { tag: 3 })]))).toEqual([
			'/summary/root/children/0/tag: a "heading" node needs a string here.',
			'/summary/root/children/0/tag: 3 is not available for a "heading" node in this field\'s editor. Allowed: h4',
		]);
	});

	it("leaves a node property alone when the editor narrows nothing", () => {
		expect(checkPost(state([node("heading", { tag: "h2" })]))).toEqual([]);
	});

	it("rejects a node missing what its class hydrates from", () => {
		const listItem = node("listitem", { value: 1 }, [textNode("hi")]);

		delete (listItem as Partial<typeof listItem>).indent;

		expect(
			checkPost(
				state([
					node("list", { listType: "bullet", start: 1, tag: "ul" }, [listItem]),
				]),
			),
		).toEqual([
			'/content/root/children/0/children/0: a "listitem" node is missing "indent". Write nodes as Lexical serializes them.',
		]);

		expect(checkPost(state([{ type: "quote" }]))).toEqual([
			'/content/root/children/0: a "quote" node is missing "children", "direction", "indent", "version". Write nodes as Lexical serializes them.',
		]);
	});

	it("rejects a required property of the wrong kind", () => {
		const item = (indent: unknown) =>
			state([
				node("list", { listType: "bullet", start: 1, tag: "ul" }, [
					{ ...node("listitem", { value: 1 }, [textNode("hi")]), indent },
				]),
			]);

		/* The value Lexical's setIndent throws on, not merely an absent one. */
		expect(checkPost(item(null))).toEqual([
			'/content/root/children/0/children/0/indent: a "listitem" node needs a number here.',
		]);
		expect(checkPost(item("0"))).toEqual([
			'/content/root/children/0/children/0/indent: a "listitem" node needs a number here.',
		]);
		expect(checkPost(item(0))).toEqual([]);
	});

	it("takes null for a direction and nothing else", () => {
		expect(checkPost(state([node("paragraph", { direction: null })]))).toEqual(
			[],
		);
		expect(
			checkPost(state([node("paragraph", { direction: "sideways" })])),
		).toEqual([
			'/content/root/children/0/direction: a "paragraph" node needs "ltr", "rtl" or null here.',
		]);
	});

	it("pins the two values a tab node is allowed to carry", () => {
		const tab = (extra: Record<string, unknown>) =>
			checkPost(
				state([
					node("paragraph", {}, [
						{
							detail: 2,
							format: 0,
							mode: "normal",
							style: "",
							text: "\t",
							type: "tab",
							version: 1,
							...extra,
						},
					]),
				]),
			);

		expect(tab({})).toEqual([]);
		expect(tab({ detail: 0 })).toEqual([
			'/content/root/children/0/children/0/detail: a "tab" node needs 2 here.',
		]);
	});

	it("checks the kind of a root property too", () => {
		expect(
			checkPost({ ...state([]), root: { ...state([]).root, indent: "0" } }),
		).toEqual(["/content/root/indent: the root node needs a number here."]);
	});

	it("asks for a version on a node type it knows nothing else about", () => {
		expect(checkPost(state([{ type: "horizontalrule", version: 1 }]))).toEqual(
			[],
		);
		expect(checkPost(state([{ type: "horizontalrule" }]))).toEqual([
			'/content/root/children/0: a "horizontalrule" node is missing "version". Write nodes as Lexical serializes them.',
		]);
	});

	it("checks the root against the shape Payload declares for it", () => {
		expect(
			checkPost({ root: { children: [], type: "root", version: 1 } }),
		).toEqual([
			'/content/root: the root node is missing "direction", "format", "indent". Write nodes as Lexical serializes them.',
		]);

		expect(
			checkPost({ ...state([]), root: { ...state([]).root, textFormat: 0 } }),
		).toEqual([
			"/content/root/textFormat: no such property on the root node. Available: children, direction, format, indent, type, version",
		]);

		expect(checkPost(state([]))).toEqual([]);
	});

	it("checks the fields a Lexical node carries", () => {
		expect(
			checkPost(linkNode({ linkType: "custom", rel: "nofollow", url: "/x" })),
		).toEqual([]);
		expect(checkPost(linkNode({ relation: "nofollow", url: "/x" }))).toEqual([
			"/content/root/children/0/fields/relation: no such field. Available: linkType, url, doc, newTab, rel",
		]);
		expect(checkPost(linkNode("nope"))).toEqual([
			'/content/root/children/0/fields: a "link" node needs an object here.',
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
