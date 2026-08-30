import { beforeAll, describe, expect, it } from "vitest";

import { resolveDataPointer } from "./pointer.js";
import { ARRAY_MARKER } from "./walk.js";
import { buildFixtureConfig } from "../../test/fixtures/config.js";

import type { SanitizedConfig } from "payload";

let config: SanitizedConfig;

beforeAll(async () => {
	config = await buildFixtureConfig();
});

/**
 * A page whose first section is a `sectionWrapper` and whose second is a
 * `richText`, so the same index resolves to different shapes.
 */
const DOC = {
	layout: {
		color: "light",
		sections: [
			{
				blockType: "sectionWrapper",
				identifier: "first",
				modules: [{ blockType: "hero", imageSize: "large" }],
			},
			{ blockType: "richText", content: null },
		],
	},
	meta: { title: "Meta" },
	title: "Home",
};

const resolve = (pointer: string, added?: unknown) =>
	resolveDataPointer(config, {
		...(added === undefined ? {} : { addedValue: added }),
		doc: DOC,
		pointer,
		ref: { kind: "collection", slug: "pages" },
	});

describe("resolveDataPointer", () => {
	it("resolves a top-level field", () => {
		expect(resolve("/title").descriptor).toMatchObject({ type: "text" });
		expect(resolve("/layout/color").descriptor).toMatchObject({
			type: "select",
		});
	});

	it("follows the block discriminant in the document", () => {
		const hero = resolve("/layout/sections/0/modules/0/imageSize");
		const content = resolve("/layout/sections/1/content");

		expect(hero.blockType).toBe("hero");
		expect(hero.descriptor).toMatchObject({ options: ["small", "large"] });
		expect(content.blockType).toBe("richText");
		expect(content.descriptor).toMatchObject({ type: "richText" });
	});

	it("follows the discriminant of a block nested under an array field", () => {
		const doc = {
			items: [
				{ heading: "One", actions: [] },
				{ heading: "Two", actions: [{ blockType: "cta", label: "Go" }] },
			],
			title: "Post",
		};
		const label = resolveDataPointer(config, {
			doc,
			pointer: "/items/1/actions/0/label",
			ref: { kind: "collection", slug: "posts" },
		});

		expect(label.blockType).toBe("cta");
		expect(label.descriptor).toMatchObject({ type: "text", required: true });
	});

	it("reads a container as the subtree beneath it, not as a field", () => {
		const doc = { items: [{ heading: "One" }], title: "Post" };
		const at = (pointer: string) =>
			resolveDataPointer(config, {
				doc,
				pointer,
				ref: { kind: "collection", slug: "posts" },
			});

		expect(at("/items").descriptor).toBeUndefined();
		expect(at("/items").prefix).toEqual(["items"]);
		expect(at("/items/0").descriptor).toBeUndefined();
		expect(at("/items/0").prefix).toEqual(["items", ARRAY_MARKER]);
		expect(at("/items/0/heading").descriptor).toMatchObject({ type: "text" });
		expect(resolve("/meta").descriptor).toBeUndefined();
		expect(resolve("/meta/title").descriptor).toMatchObject({ type: "text" });
	});

	it("takes the discriminant from the value when appending", () => {
		const appended = resolve("/layout/sections/-", { blockType: "richText" });

		expect(appended.blockType).toBe("richText");
		expect(appended.descriptor).toBeUndefined();
		expect(
			appended.fields.map((field) => "name" in field && field.name),
		).toContain("content");
	});

	it("refuses an element whose block cannot be told", () => {
		expect(() => resolve("/layout/sections/-")).toThrow(
			'Cannot tell which block "/layout/sections/-" is. Supply a "blockType" on the value, one of: sectionWrapper, richText',
		);
		expect(() => resolve("/layout/sections/-", { blockType: "hero" })).toThrow(
			'"hero" is not allowed at "/layout/sections". Allowed: sectionWrapper, richText',
		);
	});

	it("lists the available fields when a path does not resolve", () => {
		expect(() => resolve("/nope")).toThrow(
			'"/nope" is not a field here. Available: /title, /slug, /layout/color, /layout/sections, /meta/title',
		);
	});

	it("resolves a group as a subtree rather than a field", () => {
		expect(resolve("/meta")).toEqual({
			fields: expect.any(Array),
			prefix: ["meta"],
		});
		expect(resolve("/layout/sections/0")).toMatchObject({
			blockType: "sectionWrapper",
			prefix: [],
		});
	});

	it("refuses to descend into a leaf", () => {
		expect(() => resolve("/title/x")).toThrow(
			'"/title" is a text field and has no "/x" beneath it.',
		);
		expect(() => resolve("/layout/sections/x")).toThrow(
			'"/layout/sections" is an array; "x" is not an index.',
		);
	});
});

/**
 * A `posts` content state carrying one node of every kind the walk branches
 * on: a plain element, a node whose fields are a schema, and one whose fields
 * are a block chosen by slug.
 */
const POST = {
	content: {
		root: {
			children: [
				{
					children: [
						{
							children: [{ text: "Hi", type: "text", version: 1 }],
							fields: { rel: "nofollow", url: "/x" },
							type: "link",
							version: 3,
						},
					],
					type: "paragraph",
					version: 1,
				},
				{
					fields: { blockType: "callout", tone: "info" },
					format: "",
					type: "block",
					version: 2,
				},
			],
			direction: "ltr",
			format: "",
			indent: 0,
			type: "root",
			version: 1,
		},
	},
	title: "Post",
};

const inPost = (pointer: string, added?: unknown) =>
	resolveDataPointer(config, {
		...(added === undefined ? {} : { addedValue: added }),
		doc: POST,
		pointer,
		ref: { kind: "collection", slug: "posts" },
	});

describe("resolveDataPointer inside a rich text field", () => {
	it("resolves a node, a list of nodes and a node property", () => {
		expect(inPost("/content/root/children/0").lexical).toMatchObject({
			kind: "node",
			nodeType: "paragraph",
		});
		expect(inPost("/content/root/children").lexical).toMatchObject({
			kind: "nodes",
			nodeType: "root",
		});
		expect(
			inPost("/content/root/children/0/children/0/fields/url").lexical,
		).toBeUndefined();
		expect(inPost("/content/root/children/0/format").lexical).toMatchObject({
			kind: "property",
			nodeType: "paragraph",
			property: "format",
		});
	});

	it("keeps the field's own descriptor at every position inside it", () => {
		const at = inPost("/content/root/children/0/children/0");

		expect(at.descriptor).toMatchObject({ path: "/content", type: "richText" });
		expect(at.lexical).toMatchObject({ kind: "node", nodeType: "link" });
	});

	it("marks the root, so a write to it can be refused", () => {
		expect(inPost("/content/root").lexical).toMatchObject({
			isRoot: true,
			kind: "node",
		});
		expect(inPost("/content/root/indent").lexical).toMatchObject({
			isRoot: true,
			kind: "property",
		});
	});

	it("returns to Payload fields at a node's fields", () => {
		const link = inPost("/content/root/children/0/children/0/fields/rel");

		expect(link.lexical).toBeUndefined();
		expect(link.descriptor).toMatchObject({
			options: ["nofollow", "sponsored"],
			type: "select",
		});
	});

	it("reads the block a node holds from the stored node", () => {
		const block = inPost("/content/root/children/1/fields/tone");

		expect(block.blockType).toBe("callout");
		expect(block.descriptor).toMatchObject({ options: ["info", "warning"] });
	});

	it("takes the type of an appended node from the value being added", () => {
		expect(
			inPost("/content/root/children/-", { type: "heading" }).lexical,
		).toMatchObject({ kind: "node" });
		expect(
			inPost("/content/root/children/-/tag", { type: "heading" }).lexical,
		).toMatchObject({ nodeType: "heading", property: "tag" });
	});

	it("resolves a state held by a block, keeping the block in scope", () => {
		const nested = resolveDataPointer(config, {
			doc: {
				layout: {
					sections: [
						{
							blockType: "richText",
							content: {
								root: { children: [{ type: "paragraph", version: 1 }] },
							},
						},
					],
				},
			},
			pointer: "/layout/sections/0/content/root/children/0/indent",
			ref: { kind: "collection", slug: "pages" },
		});

		expect(nested.blockType).toBe("richText");
		expect(nested.descriptor).toMatchObject({ type: "richText" });
		expect(nested.lexical).toMatchObject({
			kind: "property",
			nodeType: "paragraph",
			property: "indent",
		});
	});

	it("refuses what it cannot resolve", () => {
		expect(() => inPost("/summary/root/children/0")).toThrow(
			/holds no editor state yet/,
		);
		expect(() => inPost("/content/children/0")).toThrow(/entered at "root"/);
		expect(() => inPost("/content/root/children/first")).toThrow(
			'"/content/root/children" is a list; "first" is not an index.',
		);
		expect(() => inPost("/content/root/children/-/tag")).toThrow(
			'Cannot tell which node "/content/root/children/-" is.',
		);
		expect(() => inPost("/content/root/children/0/children/9/tag")).toThrow(
			'Cannot tell which node "/content/root/children/0/children/9" is.',
		);
		expect(() => inPost("/content/root/children/0/format/x")).toThrow(
			/nothing beneath it can be addressed/,
		);
		expect(() => inPost("/content/root/children/0/fields/url")).toThrow(
			/carry no addressable fields/,
		);
	});
});
