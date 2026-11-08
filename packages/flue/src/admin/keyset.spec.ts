import { describe, expect, it } from "vitest";

import {
	decodeCursor,
	encodeCursor,
	keysetOf,
	keysetWhere,
	whereParams,
} from "./keyset.js";

const AT = "2026-11-08T10:42:00.000Z";

// The query as Payload's REST API receives it, decoded.
const entries = (params: URLSearchParams): [string, string][] => [
	...params.entries(),
];

describe("keyset cursors", () => {
	it.each([7, "6634a2f0c1"])("round-trips the keyset of id %s", (id) => {
		expect(decodeCursor(encodeCursor({ lastMessageAt: AT, id }))).toEqual({
			lastMessageAt: AT,
			id,
		});
	});

	it.each(["", "7", "[1,2]", "{}", "not json"])(
		"decodes %j to no keyset",
		(cursor) => {
			expect(decodeCursor(cursor)).toBeUndefined();
		},
	);

	it("takes no keyset from a row without a message time", () => {
		expect(keysetOf({ id: 1, lastMessageAt: null })).toBeUndefined();
		expect(keysetOf({ id: 1, lastMessageAt: AT })).toEqual({
			lastMessageAt: AT,
			id: 1,
		});
	});
});

describe("keysetWhere", () => {
	it("leaves out rows without a message time on the first page", () => {
		expect(entries(whereParams({ and: keysetWhere() }))).toEqual([
			["where[and][0][lastMessageAt][exists]", "true"],
		]);
	});

	it("continues below the keyset, ordering rows with the same time by id", () => {
		expect(
			entries(whereParams({ and: keysetWhere({ lastMessageAt: AT, id: 41 }) })),
		).toEqual([
			["where[and][0][lastMessageAt][exists]", "true"],
			["where[and][1][or][0][lastMessageAt][less_than]", AT],
			["where[and][1][or][1][and][0][lastMessageAt][equals]", AT],
			["where[and][1][or][1][and][1][id][less_than]", "41"],
		]);
	});
});

describe("whereParams", () => {
	it("joins a list of values for in and keeps the other parameters", () => {
		expect(
			entries(
				whereParams({ id: { in: [1, 2, 3] } }, { limit: "3", depth: "0" }),
			),
		).toEqual([
			["limit", "3"],
			["depth", "0"],
			["where[id][in]", "1,2,3"],
		]);
	});
});
