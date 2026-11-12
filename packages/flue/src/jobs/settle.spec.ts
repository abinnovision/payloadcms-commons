import { describe, expect, it } from "vitest";

import { nextSleep, settlementOf } from "./settle.js";

import type { FlueSettlement } from "../protocol/events.js";

const completed: FlueSettlement = {
	submissionId: "sub-1",
	outcome: "completed",
};
const failed: FlueSettlement = {
	submissionId: "sub-2",
	outcome: "failed",
	error: { type: "internal_error" },
};

describe("settlementOf", () => {
	it("finds the settlement of the submission", () => {
		expect(settlementOf({ settlements: [completed, failed] }, "sub-2")).toEqual(
			failed,
		);
	});

	it("finds nothing without settlements", () => {
		expect(settlementOf({ settlements: [] }, "sub-1")).toBeUndefined();
	});

	it("ignores the settlements of other submissions", () => {
		expect(settlementOf({ settlements: [completed] }, "sub-3")).toBeUndefined();
	});
});

describe("nextSleep", () => {
	it("sleeps a full interval far from the deadline", () => {
		expect(nextSleep(60_000, 0, 5_000)).toBe(5_000);
	});

	it("sleeps only until a near deadline", () => {
		expect(nextSleep(10_000, 8_000, 5_000)).toBe(2_000);
	});

	it("does not sleep past the deadline", () => {
		expect(nextSleep(10_000, 12_000, 5_000)).toBe(0);
	});
});
