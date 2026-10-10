import { dummyPolyRef, dummyRef } from "../ref.js";

import type { DummyRef } from "../types.js";

/*
 * Node shapes and `version` numbers follow the `exportJSON` of the node classes
 * in @payloadcms/richtext-lexical 3.90.2 and lexical 0.50.0.
 */

/** A serialized Lexical node. Any node a builder does not cover can be passed as one. */
export interface LexicalNode {
	type: string;
	version: number;
	[key: string]: unknown;
}

/** A Lexical editor state, assignable to a generated rich text field type. */
export interface DummyRichText {
	root: {
		type: "root";
		children: LexicalNode[];
		direction: "ltr";
		format: "";
		indent: number;
		version: number;
	};
	[key: string]: unknown;
}

/** A text format, folded into the text node's bitmask. */
export type LexicalTextFormat =
	| "bold"
	| "code"
	| "italic"
	| "strikethrough"
	| "subscript"
	| "superscript"
	| "underline";

/** Inline content. A string becomes a plain text node. */
export type LexicalInline = LexicalNode | string;

/** Block content. A string becomes a paragraph. */
export type LexicalBlock = LexicalNode | string;

const FORMAT_BITS: Record<LexicalTextFormat, number> = {
	bold: 1,
	italic: 2,
	strikethrough: 4,
	underline: 8,
	code: 16,
	subscript: 32,
	superscript: 64,
};

const element = (type: string, children: LexicalNode[]): LexicalNode => ({
	type,
	version: 1,
	children,
	direction: "ltr",
	format: "",
	indent: 0,
});

const inlines = (content: LexicalInline[]): LexicalNode[] =>
	content.map((node) => (typeof node === "string" ? text(node) : node));

/**
 * A text node.
 *
 * @param value The text.
 * @param format Formats to apply, e.g. `"bold"`.
 */
export const text = (
	value: string,
	...format: LexicalTextFormat[]
): LexicalNode => ({
	type: "text",
	version: 1,
	text: value,
	format: format.reduce((bits, name) => bits | FORMAT_BITS[name], 0),
	detail: 0,
	mode: "normal",
	style: "",
});

/**
 * A paragraph.
 *
 * @param content Inline nodes, or strings as plain text.
 */
export const p = (...content: LexicalInline[]): LexicalNode => {
	const children = inlines(content);
	const first = children.find((node) => node.type === "text");

	return {
		...element("paragraph", children),
		textFormat: first?.["format"] ?? 0,
		textStyle: "",
	};
};

/**
 * A heading.
 *
 * @param tag The heading level.
 * @param content Inline nodes, or strings as plain text.
 */
export const h = (
	tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6",
	...content: LexicalInline[]
): LexicalNode => ({ ...element("heading", inlines(content)), tag });

/**
 * A link. A ref links internally to that document, a string is a custom URL.
 *
 * @param to The target document or URL.
 * @param content Inline nodes, or strings as plain text.
 */
export const link = (
	to: DummyRef | string,
	...content: LexicalInline[]
): LexicalNode => ({
	...element("link", inlines(content)),
	version: 3,
	fields:
		typeof to === "string"
			? { linkType: "custom", url: to, newTab: false }
			: {
					linkType: "internal",
					doc: dummyPolyRef(to.collection, to.key),
					newTab: false,
				},
});

/**
 * A bulleted or numbered list.
 *
 * @param kind The list type.
 * @param items One entry per list item: inline content, or an array of it.
 */
export const list = (
	kind: "bullet" | "number",
	...items: (LexicalInline | LexicalInline[])[]
): LexicalNode => ({
	...element(
		"list",
		items.map((item, index) => ({
			...element("listitem", inlines(Array.isArray(item) ? item : [item])),
			value: index + 1,
		})),
	),
	listType: kind,
	start: 1,
	tag: kind === "bullet" ? "ul" : "ol",
});

/**
 * An upload node, relating to the ref's collection.
 *
 * @param ref The upload document.
 */
export const upload = (ref: DummyRef): LexicalNode => ({
	type: "upload",
	version: 3,
	format: "",
	fields: {},
	relationTo: ref.collection,
	value: dummyRef(ref.collection, ref.key),
});

/**
 * A block node. Refs inside `fields` are resolved like anywhere else.
 *
 * @param blockType The block's slug.
 * @param fields The block's field values.
 */
export const block = (
	blockType: string,
	fields: Record<string, unknown>,
): LexicalNode => ({
	type: "block",
	version: 2,
	format: "",
	fields: { ...fields, blockType },
});

/**
 * A rich text field value.
 *
 * @param content Block nodes, or strings as paragraphs.
 */
export const richText = (...content: LexicalBlock[]): DummyRichText => ({
	root: {
		type: "root",
		children: content.map((node) =>
			typeof node === "string" ? p(node) : node,
		),
		direction: "ltr",
		format: "",
		indent: 0,
		version: 1,
	},
});
