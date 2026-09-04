import { describe, expect, it } from "vitest";

import {
	blockRowElementId,
	candidateElementIds,
	fieldElementId,
	rowPathsAlong,
} from "./element-id.js";

describe("fieldElementId", () => {
	it("joins path segments with the admin's double underscore", () => {
		expect(fieldElementId("layout.0.modules.2.heading")).toBe(
			"field-layout__0__modules__2__heading",
		);
	});

	it("handles a top-level field", () => {
		expect(fieldElementId("title")).toBe("field-title");
	});
});

describe("blockRowElementId", () => {
	it("splits the trailing index off a top-level row", () => {
		expect(blockRowElementId("layout.0")).toBe("layout-row-0");
	});

	it("splits the trailing index off a nested row", () => {
		expect(blockRowElementId("layout.0.modules.2")).toBe(
			"layout-0-modules-row-2",
		);
	});

	it("returns undefined for a path that is not a row", () => {
		expect(blockRowElementId("title")).toBeUndefined();
		expect(blockRowElementId("layout.0.heading")).toBeUndefined();
		expect(blockRowElementId("0")).toBeUndefined();
	});
});

describe("candidateElementIds", () => {
	it("prefers the row over the field wrapper for a block path", () => {
		expect(candidateElementIds("layout.0")).toEqual([
			"layout-row-0",
			"field-layout__0",
		]);
	});

	it("offers only the field wrapper for a field path", () => {
		expect(candidateElementIds("layout.0.heading")).toEqual([
			"field-layout__0__heading",
		]);
	});
});

describe("rowPathsAlong", () => {
	it("lists ancestor rows outermost first", () => {
		expect(rowPathsAlong("layout.1.modules.0.title")).toEqual([
			"layout.1",
			"layout.1.modules.0",
		]);
	});

	it("includes the path itself when it is a row", () => {
		expect(rowPathsAlong("layout.1.modules.0")).toEqual([
			"layout.1",
			"layout.1.modules.0",
		]);
	});

	it("returns nothing for a path with no rows", () => {
		expect(rowPathsAlong("title")).toEqual([]);
	});

	it("ignores a leading index, which cannot be a row", () => {
		expect(rowPathsAlong("0.title")).toEqual([]);
	});
});
