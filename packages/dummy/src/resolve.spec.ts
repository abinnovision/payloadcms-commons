import { describe, expect, it } from "vitest";

import { dummyPolyRef, dummyRef } from "./ref.js";
import { applyRefs, collectRefs } from "./resolve.js";

/* Resolves anything in the map and leaves everything else pointing forward. */
const resolver =
	(known: Record<string, string>) =>
	(ref: { collection: string; key: string }): string | undefined =>
		known[`${ref.collection}:${ref.key}`];

const KNOWN = resolver({ "authors:ada": "a1", "pages:/": "p1" });
const NONE = resolver({});

/** A minimal Lexical state carrying one link node. */
const richText = (reference: unknown): Record<string, unknown> => ({
	root: {
		type: "root",
		children: [
			{
				type: "paragraph",
				children: [
					{ type: "text", text: "see " },
					{
						type: "link",
						fields: { link: { type: "reference", reference } },
						children: [{ type: "text", text: "this" }],
					},
				],
			},
		],
	},
});

describe("collectRefs", () => {
	it("finds a ref at the top level, in an array and inside a block", () => {
		const found = collectRefs({
			author: dummyRef("authors", "ada"),
			tags: [dummyRef("tags", "x"), dummyRef("tags", "y")],
			layout: [{ blockType: "card", link: dummyRef("pages", "/") }],
		});

		expect(found.map((ref) => `${ref.collection}:${ref.key}`)).toEqual([
			"authors:ada",
			"tags:x",
			"tags:y",
			"pages:/",
		]);
	});

	it("finds a ref inside a rich text link node", () => {
		expect(
			collectRefs(richText(dummyPolyRef("articles", "hello"))),
		).toHaveLength(1);
	});

	it("finds nothing in data that carries no ref", () => {
		expect(collectRefs({ title: "x", rows: [{ n: 1 }] })).toEqual([]);
	});
});

describe("applyRefs", () => {
	it("substitutes a bare id for an id ref", () => {
		const { value, unresolved } = applyRefs(
			{ author: dummyRef("authors", "ada") },
			KNOWN,
		);

		expect(value).toEqual({ author: "a1" });
		expect(unresolved).toEqual([]);
	});

	it("substitutes a relationTo pair for a polymorphic ref", () => {
		const { value } = applyRefs({ related: dummyPolyRef("pages", "/") }, KNOWN);

		expect(value).toEqual({ related: { relationTo: "pages", value: "p1" } });
	});

	it("substitutes every element of a hasMany array", () => {
		const { value } = applyRefs(
			{ refs: [dummyRef("authors", "ada"), dummyRef("pages", "/")] },
			KNOWN,
		);

		expect(value).toEqual({ refs: ["a1", "p1"] });
	});

	it("substitutes a ref nested two levels inside a blocks field", () => {
		const { value } = applyRefs(
			{ layout: [{ blockType: "card", link: dummyRef("pages", "/") }] },
			KNOWN,
		);

		expect(value).toEqual({
			layout: [{ blockType: "card", link: "p1" }],
		});
	});

	it("leaves a Date alone rather than walking into it", () => {
		const when = new Date("2026-01-01");
		const { value } = applyRefs({ when }, KNOWN);

		expect(value.when).toBe(when);
	});

	it("drops the top-level field holding an unresolved ref", () => {
		const { value, unresolved } = applyRefs(
			{ slug: "/about", author: dummyRef("authors", "ada") },
			NONE,
		);

		expect(value).toEqual({ slug: "/about" });
		expect(unresolved.map((ref) => ref.key)).toEqual(["ada"]);
	});

	it("drops only the array element whose ref is unresolved", () => {
		const { value } = applyRefs(
			{
				layout: [
					{ blockType: "callout", body: "kept" },
					{ blockType: "card", link: dummyRef("missing", "x") },
				],
			},
			NONE,
		);

		expect(value).toEqual({
			layout: [{ blockType: "callout", body: "kept" }],
		});
	});

	it("bubbles a taint out of a nested object to the enclosing array element", () => {
		const { value } = applyRefs(
			{
				layout: [
					{
						blockType: "card",
						link: { type: "reference", reference: dummyRef("missing", "x") },
					},
				],
			},
			NONE,
		);

		expect(value).toEqual({ layout: [] });
	});

	it("drops a whole rich text state rather than a lone link node", () => {
		const { value, unresolved } = applyRefs(
			{ slug: "/", content: richText(dummyPolyRef("articles", "hello")) },
			NONE,
		);

		expect(value).toEqual({ slug: "/" });
		expect(unresolved).toHaveLength(1);
	});

	it("keeps a rich text state whose refs all resolve", () => {
		const { value, unresolved } = applyRefs(
			{ content: richText(dummyPolyRef("pages", "/")) },
			KNOWN,
		);
		const content = value.content as Record<string, Record<string, unknown[]>>;
		const paragraph = content["root"]?.["children"]?.[0] as {
			children: { fields?: { link?: { reference?: unknown } } }[];
		};

		expect(unresolved).toEqual([]);
		expect(paragraph.children[1]?.fields?.link?.reference).toEqual({
			relationTo: "pages",
			value: "p1",
		});
	});

	it("reports the same ref once per place it appears", () => {
		const { unresolved } = applyRefs(
			{ a: dummyRef("missing", "x"), b: dummyRef("missing", "x") },
			NONE,
		);

		expect(unresolved).toHaveLength(2);
	});

	it("does not mutate the data it was given", () => {
		const data = { author: dummyRef("authors", "ada") };

		applyRefs(data, KNOWN);

		expect(data.author).toEqual(dummyRef("authors", "ada"));
	});
});
