import { describe, expect, it } from "vitest";

import { sortPaths, wherePaths } from "./query-paths.js";

describe("wherePaths", () => {
	it("lists the keys that are not and or or", () => {
		expect(
			wherePaths({ title: { equals: "a" }, "author.email": { exists: true } }),
		).toEqual(["title", "author.email"]);
	});

	it("descends into nested and and or in any case", () => {
		expect(
			wherePaths({
				OR: [{ and: [{ a: { equals: 1 } }, { b: { equals: 2 } }] }, { c: {} }],
			}),
		).toEqual(["a", "b", "c"]);
	});

	it("treats an and that is not an array as a path", () => {
		expect(wherePaths({ and: { equals: 1 } })).toEqual(["and"]);
	});

	it("lists nothing for a value that is not an object", () => {
		expect(wherePaths(undefined)).toEqual([]);
		expect(wherePaths({ or: ["a", null] })).toEqual([]);
	});
});

describe("sortPaths", () => {
	it("strips the descending prefix and splits on commas", () => {
		expect(sortPaths("title, -author.email,createdAt")).toEqual([
			"title",
			"author.email",
			"createdAt",
		]);
	});

	it("lists nothing without a sort", () => {
		expect(sortPaths(undefined)).toEqual([]);
	});
});
