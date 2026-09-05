import { describe, expect, it } from "vitest";

import { hasDuplicates } from "./has-duplicates.js";

describe("hasDuplicates", () => {
	it("is false for an empty list", () => {
		expect(hasDuplicates([])).toBe(false);
	});

	it("is false when every key is distinct", () => {
		expect(hasDuplicates(["pages", "articles", "notes"])).toBe(false);
	});

	it("is true when a key repeats", () => {
		expect(hasDuplicates(["pages", "articles", "pages"])).toBe(true);
	});

	it("is false for a single undefined entry", () => {
		expect(hasDuplicates([undefined])).toBe(false);
	});

	/*
	 * Undefined entries are kept rather than filtered: two rows with no
	 * collection chosen yet are still two rows claiming the same empty name,
	 * and an editor should hear that at the point they save.
	 */
	it("is true for two undefined entries", () => {
		expect(hasDuplicates([undefined, undefined])).toBe(true);
	});

	it("is true when an undefined entry repeats alongside real keys", () => {
		expect(hasDuplicates(["pages", undefined, "articles", undefined])).toBe(
			true,
		);
	});

	it("treats an empty string as distinct from undefined", () => {
		expect(hasDuplicates(["", undefined])).toBe(false);
	});
});
