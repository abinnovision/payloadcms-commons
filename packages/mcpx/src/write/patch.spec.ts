import { describe, expect, it } from "vitest";

import {
	applyPatchToCopy,
	droppedPointer,
	isElementPointer,
	isReservedPointer,
	PATCH_OPERATION_SCHEMA,
	stripRowIds,
} from "./patch.js";

const DOC = {
	id: "p1",
	layout: {
		color: "light",
		sections: [
			{
				id: "row-1",
				blockType: "sectionWrapper",
				identifier: "first",
				modules: [{ id: "row-2", blockType: "hero", imageSize: "small" }],
			},
		],
	},
	title: "Home",
};

describe("pATCH_OPERATION_SCHEMA", () => {
	it("accepts the six RFC 6902 operations", () => {
		for (const op of ["add", "copy", "move", "remove", "replace", "test"]) {
			expect(PATCH_OPERATION_SCHEMA.safeParse({ op, path: "/a" }).success).toBe(
				true,
			);
		}
	});

	it("rejects an unknown operation", () => {
		expect(
			PATCH_OPERATION_SCHEMA.safeParse({ op: "set", path: "/a" }).success,
		).toBe(false);
	});
});

describe("pointer helpers", () => {
	it("recognises pointers at fields Payload maintains", () => {
		expect(isReservedPointer("/_status")).toBe(true);
		expect(isReservedPointer("/layout/sections/0/id")).toBe(true);
		expect(isReservedPointer("/title")).toBe(false);
	});

	it("tells list elements from fields", () => {
		expect(isElementPointer("/layout/sections/0")).toBe(true);
		expect(isElementPointer("/layout/sections/-")).toBe(true);
		expect(isElementPointer("/layout/color")).toBe(false);
	});

	it("reports what an operation drops", () => {
		expect(droppedPointer({ op: "remove", path: "/a" })).toBe("/a");
		expect(droppedPointer({ op: "move", from: "/a", path: "/b" })).toBe("/a");
		expect(droppedPointer({ op: "replace", path: "/a", value: 1 })).toBe(
			undefined,
		);
	});
});

describe("stripRowIds", () => {
	it("drops ids from rows and nested rows, keeping everything else", () => {
		expect(
			stripRowIds([
				{ id: "a", blockType: "hero", title: "x" },
				{ id: "b", nested: [{ id: "c", text: "y" }] },
			]),
		).toEqual([{ blockType: "hero", title: "x" }, { nested: [{ text: "y" }] }]);
	});

	it("drops the id of a single block value", () => {
		expect(stripRowIds({ id: "a", blockType: "hero" })).toEqual({
			blockType: "hero",
		});
	});

	it("leaves plain objects and scalars alone", () => {
		expect(stripRowIds({ id: "keep", title: "x" })).toEqual({
			id: "keep",
			title: "x",
		});
		expect(stripRowIds("tag-1")).toBe("tag-1");
		expect(
			stripRowIds({ root: { children: [{ id: "n", type: "text" }] } }),
		).toEqual({ root: { children: [{ id: "n", type: "text" }] } });
	});
});

describe("applyPatchToCopy", () => {
	it("applies on a copy and leaves the original untouched", () => {
		const result = applyPatchToCopy(DOC, [
			{ op: "replace", path: "/title", value: "New" },
		]);

		expect(result).toEqual({
			next: expect.objectContaining({ title: "New" }),
		});
		expect(DOC.title).toBe("Home");
	});

	it("applies nothing when one operation fails", () => {
		const result = applyPatchToCopy(DOC, [
			{ op: "replace", path: "/title", value: "New" },
			{ op: "test", path: "/layout/color", value: "dark" },
		]);

		expect(result).toEqual({
			problems: [expect.stringContaining("patches[1]")],
		});
	});

	it("strips row ids from added and copied rows", () => {
		const result = applyPatchToCopy(DOC, [
			{
				op: "add",
				path: "/layout/sections/-",
				value: { id: "row-1", blockType: "richText", content: null },
			},
			{ op: "copy", from: "/layout/sections/0", path: "/layout/sections/-" },
		]);

		expect(result).toHaveProperty("next");

		const { next } = result as { next: Record<string, unknown> };
		const sections = (next["layout"] as { sections: Record<string, unknown>[] })
			.sections;

		expect(sections).toHaveLength(3);
		expect(sections[0]).toMatchObject({ id: "row-1" });
		expect(sections[1]).not.toHaveProperty("id");
		expect(sections[2]).not.toHaveProperty("id");
		expect(
			(sections[2]?.["modules"] as Record<string, unknown>[])[0],
		).not.toHaveProperty("id");
	});
});
