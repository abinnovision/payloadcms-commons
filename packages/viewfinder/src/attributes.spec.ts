import { describe, expect, it } from "vitest";

import {
	BLOCK_ID_ATTRIBUTE,
	BLOCK_TYPE_ATTRIBUTE,
	FIELD_ATTRIBUTE,
	markBlock,
	markField,
} from "./attributes.js";

describe("markBlock", () => {
	it("carries the id", () => {
		expect(markBlock("hero-1")).toEqual({ [BLOCK_ID_ATTRIBUTE]: "hero-1" });
	});

	it("carries the block type when one is known", () => {
		expect(markBlock("hero-1", "hero")).toEqual({
			[BLOCK_ID_ATTRIBUTE]: "hero-1",
			[BLOCK_TYPE_ATTRIBUTE]: "hero",
		});
	});

	it("omits the type key entirely rather than setting it undefined", () => {
		/*
		 * React renders `undefined` attributes as absent, but an own key set to
		 * undefined would still fail `exactOptionalPropertyTypes` at every call
		 * site that reads it back.
		 */
		expect(BLOCK_TYPE_ATTRIBUTE in markBlock("hero-1")).toBe(false);
	});
});

describe("markField", () => {
	it("carries a block-relative field name", () => {
		expect(markField("heading")).toEqual({ [FIELD_ATTRIBUTE]: "heading" });
	});

	it("carries a path into a nested array", () => {
		expect(markField("items.0.label")).toEqual({
			[FIELD_ATTRIBUTE]: "items.0.label",
		});
	});
});
