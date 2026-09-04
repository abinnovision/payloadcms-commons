import { describe, expect, it } from "vitest";

import { blockPaths, rowPathAt, sameRows } from "./rows.js";

import type { RowNode } from "./rows.js";
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

describe("sameRows", () => {
	/* Identity is all `sameRows` compares, so bare markers stand in for elements. */
	const a = Symbol("a");
	const b = Symbol("b");

	it("is true for the same rows in the same elements", () => {
		expect(
			sameRows(new Map([["layout.0", a]]), new Map([["layout.0", a]])),
		).toBe(true);
	});

	it("is false when a row moved to a different element", () => {
		/*
		 * The guard that stops the scan/portal/mutate loop: it has to notice a
		 * re-rendered row, or the buttons attach to a detached node.
		 */
		expect(
			sameRows(new Map([["layout.0", a]]), new Map([["layout.0", b]])),
		).toBe(false);
	});

	it("is false when rows appear or disappear", () => {
		expect(sameRows(new Map(), new Map([["layout.0", a]]))).toBe(false);
		expect(sameRows(new Map([["layout.0", a]]), new Map())).toBe(false);
	});

	it("is false when the same count covers different paths", () => {
		expect(
			sameRows(new Map([["layout.0", a]]), new Map([["layout.1", a]])),
		).toBe(false);
	});
});

describe("rowPathAt", () => {
	/* Only the parent chain matters here, so stubs stand in for the DOM. */
	const node = (parentElement: RowNode | null): RowNode => ({ parentElement });

	const wrapper = node(null);
	const wrapperBody = node(wrapper);
	const nested = node(wrapperBody);
	const nestedField = node(nested);

	const rows = new Map<RowNode, string>([
		[wrapper, "layout.0"],
		[nested, "layout.0.modules.0"],
	]);

	it("finds the row a field belongs to", () => {
		expect(rowPathAt(rows, nestedField)).toBe("layout.0.modules.0");
	});

	it("prefers the innermost row, not the one that encloses it", () => {
		/*
		 * The nested row is reached first on the way up, which is what makes a
		 * hero inside a section wrapper highlight the hero.
		 */
		expect(rowPathAt(rows, nested)).toBe("layout.0.modules.0");
	});

	it("finds the enclosing row from a part of it that is not in another row", () => {
		expect(rowPathAt(rows, wrapperBody)).toBe("layout.0");
	});

	it("is undefined outside every row, and for nothing at all", () => {
		expect(rowPathAt(rows, node(null))).toBeUndefined();
		expect(rowPathAt(rows, null)).toBeUndefined();
	});
});
