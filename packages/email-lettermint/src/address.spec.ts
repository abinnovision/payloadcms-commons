import { describe, expect, it } from "vitest";

import {
	normalizeAddress,
	normalizeAddressList,
	splitAddressList,
} from "./address.js";

describe("normalizeAddress", () => {
	it("passes a plain string through, trimmed", () => {
		expect(normalizeAddress("  a@b.io ")).toBe("a@b.io");
	});

	it("renders a structured address", () => {
		expect(normalizeAddress({ name: "Jane", address: "jane@b.io" })).toBe(
			"Jane <jane@b.io>",
		);
	});

	it("drops an empty name rather than emitting empty brackets", () => {
		expect(normalizeAddress({ name: "  ", address: "jane@b.io" })).toBe(
			"jane@b.io",
		);
	});

	it("quotes a name containing specials", () => {
		expect(normalizeAddress({ name: "Doe, Jane", address: "jane@b.io" })).toBe(
			'"Doe, Jane" <jane@b.io>',
		);
	});

	it("escapes quotes and backslashes inside a quoted name", () => {
		expect(normalizeAddress({ name: 'A "B" \\ C', address: "a@b.io" })).toBe(
			'"A \\"B\\" \\\\ C" <a@b.io>',
		);
	});
});

describe("splitAddressList", () => {
	it("splits on separating commas", () => {
		expect(splitAddressList("a@b.io, c@d.io")).toStrictEqual([
			"a@b.io",
			"c@d.io",
		]);
	});

	it("keeps a comma inside a quoted display name", () => {
		expect(splitAddressList('"Doe, Jane" <j@x.io>, a@y.io')).toStrictEqual([
			'"Doe, Jane" <j@x.io>',
			"a@y.io",
		]);
	});

	it("keeps a comma inside an angle-addr", () => {
		expect(splitAddressList("Jane <j,x@x.io>, a@y.io")).toStrictEqual([
			"Jane <j,x@x.io>",
			"a@y.io",
		]);
	});

	it("drops empty entries", () => {
		expect(splitAddressList("a@b.io, , ")).toStrictEqual(["a@b.io"]);
	});
});

describe("normalizeAddressList", () => {
	it("returns an empty list for an absent field", () => {
		expect(normalizeAddressList(undefined)).toStrictEqual([]);
	});

	it("flattens a mixed array", () => {
		expect(
			normalizeAddressList([
				"a@b.io, c@d.io",
				{ name: "E", address: "e@f.io" },
			]),
		).toStrictEqual(["a@b.io", "c@d.io", "E <e@f.io>"]);
	});
});
