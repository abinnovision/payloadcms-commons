import { describe, expect, it } from "vitest";

import { describeRef, dummyPolyRef, dummyRef, isDummyRef } from "./ref.js";

describe("dummyRef", () => {
	it("names a collection and a key", () => {
		expect(dummyRef("authors", "ada")).toEqual({
			__dummyRef: "id",
			collection: "authors",
			key: "ada",
		});
	});
});

describe("dummyPolyRef", () => {
	it("is distinguishable from an id ref", () => {
		expect(dummyPolyRef("authors", "ada").__dummyRef).toBe("polymorphic");
	});
});

describe("isDummyRef", () => {
	it("accepts both kinds", () => {
		expect(isDummyRef(dummyRef("a", "b"))).toBe(true);
		expect(isDummyRef(dummyPolyRef("a", "b"))).toBe(true);
	});

	it("rejects a look-alike and anything that is not an object", () => {
		expect(isDummyRef({ __dummyRef: "other", collection: "a", key: "b" })).toBe(
			false,
		);
		expect(isDummyRef({ collection: "a", key: "b" })).toBe(false);
		expect(isDummyRef(null)).toBe(false);
		expect(isDummyRef("ref")).toBe(false);
	});

	it("survives structuredClone, because the brand is a string", () => {
		expect(isDummyRef(structuredClone(dummyRef("a", "b")))).toBe(true);
	});

	it("survives a JSON round trip", () => {
		expect(isDummyRef(JSON.parse(JSON.stringify(dummyRef("a", "b"))))).toBe(
			true,
		);
	});
});

describe("describeRef", () => {
	it("reads as collection and quoted key", () => {
		expect(describeRef(dummyRef("authors", "ada"))).toBe('authors:"ada"');
	});
});
