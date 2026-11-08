import { describe, expect, it } from "vitest";

import {
	RECHECK_AFTER_MS,
	STALE_AFTER_MS,
	staleRunning,
} from "./stale-running.js";

const now = Date.parse("2026-11-08T12:00:00.000Z");
const ago = (ms: number): string => new Date(now - ms).toISOString();
const stale = ago(STALE_AFTER_MS + 1000);

describe("staleRunning", () => {
	it("picks at most three stale running rows, in list order", () => {
		const rows = [1, 2, 3, 4].map((id) => ({
			id,
			status: "running",
			lastMessageAt: stale,
		}));

		expect(staleRunning(rows, now, new Map())).toEqual(["1", "2", "3"]);
	});

	it("skips rows younger than two minutes, rows not running and rows without a time", () => {
		expect(
			staleRunning(
				[
					{
						id: 1,
						status: "running",
						lastMessageAt: ago(STALE_AFTER_MS - 1000),
					},
					{ id: 2, status: "idle", lastMessageAt: stale },
					{ id: 3, status: "failed", lastMessageAt: stale },
					{ id: 4, status: "running", lastMessageAt: null },
					{ id: 5, status: "running", lastMessageAt: stale },
				],
				now,
				new Map(),
			),
		).toEqual(["5"]);
	});

	it("skips a row read less than five minutes ago and picks it again after", () => {
		const rows = [{ id: 1, status: "running", lastMessageAt: stale }];

		expect(
			staleRunning(rows, now, new Map([["1", now - RECHECK_AFTER_MS + 1000]])),
		).toEqual([]);
		expect(
			staleRunning(rows, now, new Map([["1", now - RECHECK_AFTER_MS]])),
		).toEqual(["1"]);
	});
});
