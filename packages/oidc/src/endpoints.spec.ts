import { describe, expect, it } from "vitest";

import { safeRedirect } from "./endpoints.js";

describe("safeRedirect", () => {
	it.each(["/admin", "/admin/collections/users?x=1"])("keeps %s", (path) => {
		expect(safeRedirect(path, "/fallback")).toBe(path);
	});

	it.each([
		"https://evil.example",
		"//evil.example",
		"/\\evil.example",
		"/\t/evil.example",
		"/\n/evil.example",
		"/%2F%2Fevil.example",
		"admin",
		null,
	])("rejects %j", (value) => {
		expect(safeRedirect(value, "/fallback")).toBe("/fallback");
	});
});
