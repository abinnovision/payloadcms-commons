import { describe, expect, it } from "vitest";

import { resolveAddressForElement } from "./from-element.js";

import type { FormStateLike } from "../resolve-path.js";
import type { AncestorElement } from "./from-element.js";

const value = (v: unknown): { value: unknown } => ({ value: v });

const formState: FormStateLike = {
	id: value("page-1"),
	"layout.0.id": value("sec-a"),
	"layout.0.blockType": value("section-wrapper"),
	"layout.0.modules.0.id": value("hero-1"),
	"layout.0.modules.0.blockType": value("hero"),
	"layout.0.modules.0.heading": value("Hi"),
};

/** Builds a leaf-to-root chain of ids, mirroring `parentElement` walks. */
const chain = (...ids: string[]): AncestorElement =>
	ids.reduce<AncestorElement | null>(
		(parentElement, id) => ({ id, parentElement }),
		null,
	) as AncestorElement;

describe("resolveAddressForElement", () => {
	it("resolves a field input to its enclosing block plus field", () => {
		const target = chain(
			"layout-row-0",
			"field-layout__0__modules",
			"layout-0-modules-row-0",
			"field-layout__0__modules__0__heading",
			"",
		);

		expect(resolveAddressForElement(formState, target)).toEqual({
			id: "hero-1",
			blockType: "hero",
			field: "heading",
		});
	});

	it("resolves a click on a row header to the block itself", () => {
		/*
		 * The row sits inside the enclosing blocks field's wrapper, so checking
		 * field wrappers first would report `layout.0.modules` — a blocks
		 * field, not a block.
		 */
		const target = chain(
			"layout-row-0",
			"field-layout__0__modules",
			"layout-0-modules-row-0",
			"",
		);

		expect(resolveAddressForElement(formState, target)).toEqual({
			id: "hero-1",
			blockType: "hero",
		});
	});

	it("resolves an outer row when nothing nearer matches", () => {
		expect(
			resolveAddressForElement(formState, chain("layout-row-0", "")),
		).toEqual({ id: "sec-a", blockType: "section-wrapper" });
	});

	it("returns undefined outside any block", () => {
		expect(
			resolveAddressForElement(formState, chain("field-title", "")),
		).toBeUndefined();
		expect(resolveAddressForElement(formState, null)).toBeUndefined();
	});
});
