import { describe, expect, it } from "vitest";

import { defineDummySeed } from "./define-seed.js";
import { selectSeeds, sortSeeds } from "./graph.js";
import { diamond, tracer } from "../test/builders/seeds.js";

const ids = (seeds: readonly { id: string }[]): string[] =>
	seeds.map((seed) => seed.id);

describe("sortSeeds", () => {
	it("puts a dependency before the seed that names it", () => {
		const sorted = sortSeeds(diamond([]));

		expect(ids(sorted).indexOf("root")).toBeLessThan(
			ids(sorted).indexOf("left"),
		);
		expect(ids(sorted).indexOf("left")).toBeLessThan(
			ids(sorted).indexOf("join"),
		);
	});

	it("keeps independent seeds in declaration order", () => {
		const order: string[] = [];

		expect(ids(sortSeeds([tracer("b", order), tracer("a", order)]))).toEqual([
			"b",
			"a",
		]);
	});

	it("sorts the same way every time", () => {
		const first = ids(sortSeeds(diamond([])));

		expect(ids(sortSeeds(diamond([])))).toEqual(first);
	});

	it("refuses a duplicate id", () => {
		const order: string[] = [];

		expect(() => sortSeeds([tracer("a", order), tracer("a", order)])).toThrow(
			/"a" is declared twice/,
		);
	});

	it("refuses an empty id", () => {
		expect(() => sortSeeds([tracer("", [])])).toThrow(/empty id/);
	});

	it("refuses a dependency that is not declared, listing the ones that are", () => {
		const order: string[] = [];

		expect(() => sortSeeds([tracer("pages", order, ["sections"])])).toThrow(
			/depends on "sections".*Declared seeds: pages/s,
		);
	});

	it("names the cycle rather than the seeds it could not place", () => {
		const order: string[] = [];

		expect(() =>
			sortSeeds([
				tracer("chrome", order, ["pages"]),
				tracer("pages", order, ["chrome"]),
			]),
		).toThrow(/cycle: chrome -> pages -> chrome/);
	});

	it("reports a seed that depends on itself as a cycle", () => {
		expect(() => sortSeeds([tracer("a", [], ["a"])])).toThrow(/cycle: a -> a/);
	});
});

describe("selectSeeds", () => {
	const sorted = sortSeeds(diamond([]));

	it("keeps every seed when nothing is named", () => {
		expect(selectSeeds(sorted, undefined)).toEqual(sorted);
		expect(selectSeeds(sorted, [])).toEqual(sorted);
	});

	it("keeps only the named seeds, in run order", () => {
		expect(ids(selectSeeds(sorted, ["join", "root"]))).toEqual([
			"root",
			"join",
		]);
	});

	it("does not pull in a dependency of a named seed", () => {
		expect(ids(selectSeeds(sorted, ["join"]))).toEqual(["join"]);
	});

	it("refuses an id that is not declared", () => {
		expect(() => selectSeeds(sorted, ["nope"])).toThrow(/No seed named "nope"/);
	});
});

describe("defineDummySeed", () => {
	it("answers its input unchanged", () => {
		const seed = {
			id: "a",
			run: async () => {
				await Promise.resolve();
			},
		};

		expect(defineDummySeed(seed)).toBe(seed);
	});
});
