import { describe, expect, it } from "vitest";

import { parseBearer } from "./resolve.js";

const headers = (authorization?: string): Headers =>
	new Headers(authorization === undefined ? {} : { authorization });

describe("parseBearer", () => {
	it("returns the token of a bearer header", () => {
		expect(parseBearer(headers("Bearer abc.def"))).toBe("abc.def");
	});

	it("accepts any casing of the scheme and surrounding whitespace", () => {
		expect(parseBearer(headers("  bearer   abc  "))).toBe("abc");
	});

	it("returns null without a header", () => {
		expect(parseBearer(headers())).toBeNull();
	});

	it("returns null for other schemes", () => {
		expect(parseBearer(headers("users API-Key abc"))).toBeNull();
		expect(parseBearer(headers("Basic abc"))).toBeNull();
	});

	it("returns null for an empty token", () => {
		expect(parseBearer(headers("Bearer "))).toBeNull();
		expect(parseBearer(headers("Bearer"))).toBeNull();
	});
});
