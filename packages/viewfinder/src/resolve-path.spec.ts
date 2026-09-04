import { describe, expect, it } from "vitest";

import {
	resolveAddressForPath,
	resolveAddressPath,
	resolveBlockIdForPath,
	resolveBlockPath,
} from "./resolve-path.js";

import type { FormStateLike } from "./resolve-path.js";

const value = (v: unknown): { value: unknown } => ({ value: v });

/**
 * Mirrors the shape Payload's admin actually holds for the example app: a
 * `layout` blocks field of section wrappers, each with a nested `modules`
 * blocks field, and a plain array (`items`) inside one module so the block /
 * array-row distinction is exercised.
 */
const formState: FormStateLike = {
	id: value("page-1"),
	title: value("Home"),
	"layout.0.id": value("sec-a"),
	"layout.0.blockType": value("section-wrapper"),
	"layout.0.modules.0.id": value("hero-1"),
	"layout.0.modules.0.blockType": value("hero"),
	"layout.0.modules.0.heading": value("Hi"),
	"layout.1.id": value("sec-b"),
	"layout.1.blockType": value("section-wrapper"),
	"layout.1.modules.0.id": value("posts-1"),
	"layout.1.modules.0.blockType": value("recent-posts"),
	"layout.1.modules.0.items.0.id": value("item-1"),
	"layout.1.modules.0.items.0.label": value("One"),
};

describe("resolveBlockPath", () => {
	it("resolves a top-level block", () => {
		expect(resolveBlockPath(formState, "sec-a")).toBe("layout.0");
	});

	it("resolves a block nested two levels deep", () => {
		expect(resolveBlockPath(formState, "hero-1")).toBe("layout.0.modules.0");
	});

	it("returns undefined for an unknown id", () => {
		expect(resolveBlockPath(formState, "nope")).toBeUndefined();
	});

	it("never matches the document's own id", () => {
		/* The document id sits at the bare key "id", which has no dot prefix. */
		expect(resolveBlockPath(formState, "page-1")).toBeUndefined();
	});

	it("prefers the shallowest path when an id is duplicated", () => {
		const duplicated: FormStateLike = {
			...formState,
			"layout.1.modules.0.nested.3.id": value("sec-a"),
		};
		expect(resolveBlockPath(duplicated, "sec-a")).toBe("layout.0");
	});
});

describe("resolveAddressPath", () => {
	it("returns the block path when no field is named", () => {
		expect(resolveAddressPath(formState, { id: "hero-1" })).toBe(
			"layout.0.modules.0",
		);
	});

	it("appends a block-relative field", () => {
		expect(
			resolveAddressPath(formState, { id: "hero-1", field: "heading" }),
		).toBe("layout.0.modules.0.heading");
	});

	it("returns undefined when the block is gone", () => {
		expect(
			resolveAddressPath(formState, { id: "nope", field: "heading" }),
		).toBeUndefined();
	});
});

describe("resolveBlockIdForPath", () => {
	it("resolves the block a field belongs to", () => {
		expect(resolveBlockIdForPath(formState, "layout.0.modules.0.heading")).toBe(
			"hero-1",
		);
	});

	it("resolves a block path to its own id", () => {
		expect(resolveBlockIdForPath(formState, "layout.0.modules.0")).toBe(
			"hero-1",
		);
	});

	it("skips plain array rows, which carry an id but no blockType", () => {
		expect(
			resolveBlockIdForPath(formState, "layout.1.modules.0.items.0.label"),
		).toBe("posts-1");
	});

	it("returns undefined for a path outside any block", () => {
		expect(resolveBlockIdForPath(formState, "title")).toBeUndefined();
	});
});

describe("resolveAddressForPath", () => {
	it("carries the field suffix for a path inside a block", () => {
		expect(
			resolveAddressForPath(formState, "layout.0.modules.0.heading"),
		).toEqual({ id: "hero-1", blockType: "hero", field: "heading" });
	});

	it("carries the array-relative remainder for a nested array row", () => {
		expect(
			resolveAddressForPath(formState, "layout.1.modules.0.items.0.label"),
		).toEqual({
			id: "posts-1",
			blockType: "recent-posts",
			field: "items.0.label",
		});
	});

	it("omits the field when the path is the block itself", () => {
		expect(resolveAddressForPath(formState, "layout.0.modules.0")).toEqual({
			id: "hero-1",
			blockType: "hero",
		});
	});

	it("returns undefined for a path outside any block", () => {
		expect(resolveAddressForPath(formState, "title")).toBeUndefined();
	});
});
