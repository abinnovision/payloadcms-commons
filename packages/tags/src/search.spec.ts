import { describe, expect, it } from "vitest";

import { matchesTag } from "./search.js";

describe("matchesTag", () => {
	it("matches a case-insensitive substring", () => {
		expect(matchesTag("News", "ne")).toBe(true);
		expect(matchesTag("News", "NE")).toBe(true);
	});

	it("trims the input before matching", () => {
		expect(matchesTag("News", "  ne  ")).toBe(true);
	});

	it("does not match an unrelated substring", () => {
		expect(matchesTag("News", "sport")).toBe(false);
	});

	it("matches everything when the input is empty or whitespace", () => {
		expect(matchesTag("News", "")).toBe(true);
		expect(matchesTag("News", "   ")).toBe(true);
	});
});
