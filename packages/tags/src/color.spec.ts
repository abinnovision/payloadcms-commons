import { describe, expect, it } from "vitest";

import { PRESETS, colorForName, isHexColor } from "./color.js";

describe("colorForName", () => {
	it("is stable for the same name", () => {
		expect(colorForName("News")).toBe(colorForName("News"));
	});

	it("returns one of the presets", () => {
		expect(PRESETS).toContain(colorForName("Anything"));
	});

	it("differs for different names, at least across a spread", () => {
		const colors = new Set(
			["a", "b", "c", "d", "e", "f", "g", "h"].map((name) =>
				colorForName(name),
			),
		);

		expect(colors.size).toBeGreaterThan(1);
	});

	it("handles an empty name", () => {
		expect(PRESETS).toContain(colorForName(""));
	});
});

describe("isHexColor", () => {
	it("accepts a 6-digit hex color", () => {
		expect(isHexColor("#3b82f6")).toBe(true);
	});

	it("accepts a 3-digit hex color", () => {
		expect(isHexColor("#fff")).toBe(true);
	});

	it("accepts uppercase digits", () => {
		expect(isHexColor("#ABCDEF")).toBe(true);
	});

	it("rejects a value without a leading #", () => {
		expect(isHexColor("3b82f6")).toBe(false);
	});

	it("rejects a value of the wrong length", () => {
		expect(isHexColor("#3b82f")).toBe(false);
	});

	it("rejects a non-string value", () => {
		expect(isHexColor(123)).toBe(false);
		expect(isHexColor(null)).toBe(false);
		expect(isHexColor(undefined)).toBe(false);
	});
});
