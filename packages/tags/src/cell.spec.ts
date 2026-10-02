import { describe, expect, it } from "vitest";

import { normalizeCellValues, tagLabel, toTag } from "./cell.js";

describe("tagLabel", () => {
	it("returns the title when present", () => {
		expect(tagLabel("News", "1")).toBe("News");
	});

	it("falls back to #id when the title is missing or empty", () => {
		expect(tagLabel(undefined, "1")).toBe("#1");
		expect(tagLabel("", "1")).toBe("#1");
	});
});

describe("toTag", () => {
	it("normalizes a populated document into a tag", () => {
		expect(toTag({ id: "1", name: "News", color: "#3b82f6" })).toEqual({
			id: "1",
			label: "News",
			color: "#3b82f6",
			readable: true,
		});
	});

	it("falls back to #id when the title field is missing or empty", () => {
		expect(toTag({ id: "1", name: "" }).label).toBe("#1");
	});

	it("reports null color when the document carries none", () => {
		expect(toTag({ id: "1", name: "News" }).color).toBeNull();
	});
});

describe("normalizeCellValues", () => {
	it("normalizes populated documents into tags", () => {
		const result = normalizeCellValues([
			{ id: "1", name: "News", color: "#3b82f6" },
		]);

		expect(result).toEqual({
			visible: [{ id: "1", label: "News", color: "#3b82f6", readable: true }],
			overflow: 0,
		});
	});

	it("falls back to a gray #id pill for a bare, unreadable id", () => {
		const result = normalizeCellValues([42]);

		expect(result).toEqual({
			visible: [{ id: 42, label: "#42", color: null, readable: false }],
			overflow: 0,
		});
	});

	it("shows at most 3 pills and folds the rest into an overflow count", () => {
		const values = [1, 2, 3, 4, 5].map((id) => ({
			id,
			name: `Tag ${String(id)}`,
		}));

		const result = normalizeCellValues(values);

		expect(result.visible).toHaveLength(3);
		expect(result.overflow).toBe(2);
	});

	it("treats null or undefined as no tags", () => {
		expect(normalizeCellValues(null)).toEqual({ visible: [], overflow: 0 });
		expect(normalizeCellValues(undefined)).toEqual({
			visible: [],
			overflow: 0,
		});
	});
});
