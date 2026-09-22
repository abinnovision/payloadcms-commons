import { describe, expect, it } from "vitest";

import { normalizeCellValues } from "./cell.js";

describe("normalizeCellValues", () => {
	it("normalizes populated documents into tags", () => {
		const result = normalizeCellValues(
			[{ id: "1", name: "News", color: "#3b82f6" }],
			"name",
		);

		expect(result).toEqual({
			visible: [{ id: "1", label: "News", color: "#3b82f6", readable: true }],
			overflow: 0,
		});
	});

	it("falls back to a gray #id pill for a bare, unreadable id", () => {
		const result = normalizeCellValues([42], "name");

		expect(result).toEqual({
			visible: [{ id: 42, label: "#42", color: null, readable: false }],
			overflow: 0,
		});
	});

	it("falls back to #id when the title field is missing or empty", () => {
		const result = normalizeCellValues([{ id: "1", name: "" }], "name");

		expect(result.visible[0]).toEqual({
			id: "1",
			label: "#1",
			color: null,
			readable: true,
		});
	});

	it("shows at most 3 pills and folds the rest into an overflow count", () => {
		const values = [1, 2, 3, 4, 5].map((id) => ({
			id,
			name: `Tag ${String(id)}`,
		}));

		const result = normalizeCellValues(values, "name");

		expect(result.visible).toHaveLength(3);
		expect(result.overflow).toBe(2);
	});

	it("treats null or undefined as no tags", () => {
		expect(normalizeCellValues(null, "name")).toEqual({
			visible: [],
			overflow: 0,
		});
		expect(normalizeCellValues(undefined, "name")).toEqual({
			visible: [],
			overflow: 0,
		});
	});

	it("reports null color when the document carries none", () => {
		const result = normalizeCellValues([{ id: "1", name: "News" }], "name");

		expect(result.visible[0]?.color).toBeNull();
	});
});
