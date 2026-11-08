import { describe, expect, it } from "vitest";

import { secretMatches } from "./http.js";

const SECRET = "sidecar-secret-0123456789abcdefghijklmnop";

describe("secretMatches", () => {
	it("accepts the secret as a Bearer token", () => {
		expect(secretMatches(`Bearer ${SECRET}`, SECRET)).toBe(true);
	});

	it.each([
		["a prefix of the secret", `Bearer ${SECRET.slice(0, -1)}`],
		["a longer value", `Bearer ${SECRET}x`],
		["an empty header", ""],
		["a missing header", null],
		["another scheme", `JWT ${SECRET}`],
		["the bare secret", SECRET],
	])("refuses %s", (_label, header) => {
		expect(secretMatches(header, SECRET)).toBe(false);
	});
});
