import { describe, expect, it } from "vitest";

import { dummyRef } from "../ref.js";
import { collectRefs } from "../resolve.js";
import { block, h, link, list, p, richText, text, upload } from "./index.js";

import type { DummyData } from "../types.js";

/** The rich text field type Payload generates. */
interface GeneratedRichText {
	root: {
		type: string;
		children: {
			type: any;
			version: number;
			[k: string]: unknown;
		}[];
		direction: ("ltr" | "rtl") | null;
		format: "left" | "start" | "center" | "right" | "end" | "justify" | "";
		indent: number;
		version: number;
	};
	[k: string]: unknown;
}

describe("richText", () => {
	it("is assignable to the generated field type, also as DummyData", () => {
		const plain: GeneratedRichText = richText("x");
		const data: DummyData<{ content?: GeneratedRichText | null }> = {
			content: richText("x"),
		};

		expect(plain.root.type).toBe("root");
		expect(data.content).toBeDefined();
	});

	it("wraps a string in a paragraph", () => {
		expect(richText("Hello").root.children).toEqual([p("Hello")]);
	});
});

describe("text", () => {
	it("is a plain text node by default", () => {
		expect(text("x")).toEqual({
			type: "text",
			version: 1,
			text: "x",
			format: 0,
			detail: 0,
			mode: "normal",
			style: "",
		});
	});

	it("folds formats into the bitmask", () => {
		expect(text("x", "bold")["format"]).toBe(1);
		expect(text("x", "bold", "italic", "underline")["format"]).toBe(11);
		expect(text("x", "superscript")["format"]).toBe(64);
	});
});

describe("p and h", () => {
	it("wrap strings in text nodes and carry the first text format", () => {
		expect(p("a ", text("b", "bold"))).toEqual({
			type: "paragraph",
			version: 1,
			children: [text("a "), text("b", "bold")],
			direction: "ltr",
			format: "",
			indent: 0,
			textFormat: 0,
			textStyle: "",
		});
		expect(p(text("b", "italic"))["textFormat"]).toBe(2);
	});

	it("tags a heading", () => {
		expect(h("h2", "Title")).toMatchObject({
			type: "heading",
			tag: "h2",
			children: [text("Title")],
		});
	});
});

describe("link", () => {
	it("links a ref internally, as a polymorphic doc", () => {
		expect(link(dummyRef("pages", "/"), "home")).toMatchObject({
			type: "link",
			version: 3,
			fields: {
				linkType: "internal",
				doc: { __dummyRef: "polymorphic", collection: "pages", key: "/" },
				newTab: false,
			},
			children: [text("home")],
		});
	});

	it("links a string as a custom URL", () => {
		expect(link("https://example.com", "x")["fields"]).toEqual({
			linkType: "custom",
			url: "https://example.com",
			newTab: false,
		});
	});
});

describe("list", () => {
	it("numbers its items and accepts an array per item", () => {
		const node = list("number", "one", ["two ", text("b", "bold")]);
		const items = node["children"] as Record<string, unknown>[];

		expect(node).toMatchObject({ listType: "number", start: 1, tag: "ol" });
		expect(items.map((item) => item["value"])).toEqual([1, 2]);
		expect(items[1]?.["children"]).toEqual([text("two "), text("b", "bold")]);
	});

	it("tags a bullet list as ul", () => {
		expect(list("bullet", "x")["tag"]).toBe("ul");
	});
});

describe("upload and block", () => {
	it("relates an upload to the ref's collection", () => {
		expect(upload(dummyRef("media", "hero.png"))).toEqual({
			type: "upload",
			version: 3,
			format: "",
			fields: {},
			relationTo: "media",
			value: dummyRef("media", "hero.png"),
		});
	});

	it("puts the block type into the fields and leaves refs as written", () => {
		const page = dummyRef("pages", "/");

		expect(block("cta", { label: "Go", page })).toMatchObject({
			type: "block",
			version: 2,
			fields: { blockType: "cta", label: "Go", page },
		});
	});
});

describe("refs inside a built state", () => {
	it("are found with the right brands", () => {
		const found = collectRefs(
			richText(
				p(link(dummyRef("pages", "/"), "x")),
				upload(dummyRef("media", "a.png")),
			),
		);

		expect(found.map((ref) => [ref.__dummyRef, ref.collection])).toEqual([
			["polymorphic", "pages"],
			["id", "media"],
		]);
	});
});
