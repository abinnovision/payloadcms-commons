import { describe, expect, it } from "vitest";

import { isValidAuthResult, parseBearer } from "./resolve.js";

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

describe("isValidAuthResult", () => {
	const options = { userCollection: "users" };
	const auth = (overrides: Record<string, unknown> = {}): unknown => ({
		user: { id: 1, collection: "users" },
		apiKeyId: "key",
		capabilities: {},
		...overrides,
	});

	it("accepts a user of the user collection with a key id", () => {
		expect(isValidAuthResult(auth(), options)).toBe(true);
		expect(
			isValidAuthResult(
				auth({ user: { id: "a", collection: "users" } }),
				options,
			),
		).toBe(true);
	});

	it("refuses a user without an id", () => {
		expect(
			isValidAuthResult(auth({ user: { collection: "users" } }), options),
		).toBe(false);
	});

	it("refuses a user of another collection", () => {
		expect(
			isValidAuthResult(
				auth({ user: { id: 1, collection: "editors" } }),
				options,
			),
		).toBe(false);
		expect(isValidAuthResult(auth({ user: { id: 1 } }), options)).toBe(false);
	});

	it("refuses a result that is not an object", () => {
		expect(isValidAuthResult(undefined, options)).toBe(false);
		expect(isValidAuthResult(null, options)).toBe(false);
		expect(isValidAuthResult("user", options)).toBe(false);
	});

	it("refuses a missing key id", () => {
		expect(isValidAuthResult(auth({ apiKeyId: undefined }), options)).toBe(
			false,
		);
	});
});
