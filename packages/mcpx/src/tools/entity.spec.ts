import { describe, expect, it } from "vitest";

import { staleReadResult } from "./entity.js";

const READ_AT = "2026-01-01T00:00:00.000Z";

describe("staleReadResult", () => {
	it("passes a stored string or Date at the instant the client read", () => {
		expect(staleReadResult({ updatedAt: READ_AT }, READ_AT, "Stale.")).toBe(
			undefined,
		);
		expect(
			staleReadResult({ updatedAt: new Date(READ_AT) }, READ_AT, "Stale."),
		).toBe(undefined);
	});

	it("refuses a stored string or Date from another instant", () => {
		const later = "2026-01-02T00:00:00.000Z";

		expect(
			staleReadResult({ updatedAt: later }, READ_AT, "Stale."),
		).toHaveProperty("isError", true);
		expect(
			staleReadResult({ updatedAt: new Date(later) }, READ_AT, "Stale."),
		).toHaveProperty("isError", true);
	});
});
