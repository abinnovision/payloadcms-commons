import { beforeAll, describe, expect, it } from "vitest";

import { pointerSegments, resolveDataPointer } from "./pointer.js";
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

describe("pointerSegments", () => {
	it("decodes escaped segments", () => {
		expect(pointerSegments("/a~1b/c~0d/0")).toEqual(["a/b", "c~d", "0"]);
		expect(pointerSegments("")).toEqual([]);
	});
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
			'Cannot tell which block "layout.sections/-" is. Supply a "blockType" on the value, one of: sectionWrapper, richText',
		);
		expect(() => resolve("/layout/sections/-", { blockType: "hero" })).toThrow(
			'"hero" is not allowed at "layout.sections". Allowed: sectionWrapper, richText',
		);
	});

	it("lists the available fields when a path does not resolve", () => {
		expect(() => resolve("/nope")).toThrow(
			'"nope" is not a field here. Available: title, slug, layout.color, layout.sections, meta.title',
		);
	});

	it("resolves a group as a subtree rather than a field", () => {
		expect(resolve("/meta")).toEqual({
			fields: expect.any(Array),
			prefix: "meta",
		});
		expect(resolve("/layout/sections/0")).toMatchObject({
			blockType: "sectionWrapper",
			prefix: "",
		});
	});

	it("refuses to descend into a leaf", () => {
		expect(() => resolve("/title/x")).toThrow(
			'"title" is a text field and has no "x" beneath it.',
		);
		expect(() => resolve("/layout/sections/x")).toThrow(
			'"layout.sections" is an array; "x" is not an index.',
		);
	});
});
