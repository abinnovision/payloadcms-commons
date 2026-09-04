import { describe, expect, it } from "vitest";

import { blockPaths, rowHoverTarget, sameHeaders } from "./row-headers.js";

import type { RowHeaderElement } from "./row-headers.js";
import type { FormStateLike } from "../resolve-path.js";

const value = (v: unknown): { value: unknown } => ({ value: v });

const formState: FormStateLike = {
	id: value("page-1"),
	title: value("Home"),
	"layout.0.id": value("sec-a"),
	"layout.0.blockType": value("section-wrapper"),
	"layout.0.modules.0.id": value("hero-1"),
	"layout.0.modules.0.blockType": value("hero"),
	"layout.0.modules.0.items.0.id": value("item-1"),
};

describe("blockPaths", () => {
	it("lists every block path, sorted, and nothing else", () => {
		expect(blockPaths(formState)).toEqual(["layout.0", "layout.0.modules.0"]);
	});

	it("ignores array rows, which carry an id but no blockType", () => {
		expect(blockPaths(formState)).not.toContain("layout.0.modules.0.items.0");
	});

	it("returns nothing for a form with no blocks", () => {
		expect(blockPaths({ id: value("page-1") })).toEqual([]);
	});
});

describe("sameHeaders", () => {
	/* Identity is all `sameHeaders` compares, so bare markers stand in for elements. */
	const a = Symbol("a");
	const b = Symbol("b");

	it("is true for the same rows in the same elements", () => {
		expect(
			sameHeaders(new Map([["layout.0", a]]), new Map([["layout.0", a]])),
		).toBe(true);
	});

	it("is false when a row moved to a different element", () => {
		/*
		 * The guard that stops the scan/portal/mutate loop: it has to notice a
		 * re-rendered row, or the buttons attach to a detached node.
		 */
		expect(
			sameHeaders(new Map([["layout.0", a]]), new Map([["layout.0", b]])),
		).toBe(false);
	});

	it("is false when rows appear or disappear", () => {
		expect(sameHeaders(new Map(), new Map([["layout.0", a]]))).toBe(false);
		expect(sameHeaders(new Map([["layout.0", a]]), new Map())).toBe(false);
	});

	it("is false when the same count covers different paths", () => {
		expect(
			sameHeaders(new Map([["layout.0", a]]), new Map([["layout.1", a]])),
		).toBe(false);
	});
});

describe("rowHoverTarget", () => {
	/* Only `closest` matters here, so a stub stands in for the DOM. */
	const stub = (found: RowHeaderElement | null): RowHeaderElement => ({
		closest: () => found,
	});

	it("prefers the toggle wrap, which is what receives pointer events", () => {
		const wrap = stub(null);
		expect(rowHoverTarget(stub(wrap))).toBe(wrap);
	});

	it("falls back to the header when the wrap is not there", () => {
		const header = stub(null);
		expect(rowHoverTarget(header)).toBe(header);
	});
});
