import { describe, expect, it } from "vitest";

import { joinPath, splitPath } from "./path.js";

describe("joinPath and splitPath", () => {
	it("round-trips array markers", () => {
		expect(joinPath(["items", "*", "title"])).toBe("/items/*/title");
		expect(splitPath("/items/*/title")).toEqual(["items", "*", "title"]);
		expect(splitPath("/layout/sections")).toEqual(["layout", "sections"]);
	});

	it("treats no segments as the root", () => {
		expect(joinPath([])).toBe("");
		expect(splitPath("")).toEqual([]);
	});

	it("escapes segments that would otherwise split", () => {
		expect(joinPath(["a/b", "c~d"])).toBe("/a~1b/c~0d");
		expect(splitPath("/a~1b/c~0d")).toEqual(["a/b", "c~d"]);
	});
});
