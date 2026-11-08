import { describe, expect, it } from "vitest";

import { dateBucket, rowTime } from "./date-buckets.js";

// Local times, so the cases hold in every time zone.
const now = new Date(2026, 10, 8, 14, 30);
const at = (
	month: number,
	day: number,
	hours = 12,
	minutes = 0,
	year = 2026,
): Date => new Date(year, month, day, hours, minutes);

describe("dateBucket", () => {
	it.each([
		["the start of today", at(10, 8, 0, 0), "Today"],
		["a time in the future", at(10, 9, 9, 0), "Today"],
		["the end of yesterday", at(10, 7, 23, 59), "Yesterday"],
		["the start of yesterday", at(10, 7, 0, 0), "Yesterday"],
		["two days ago", at(10, 6), "Previous 7 days"],
		["seven days ago", at(10, 1, 0, 0), "Previous 7 days"],
		["eight days ago", at(9, 31, 23, 59), "Previous 30 days"],
		["thirty days ago", at(9, 9, 0, 0), "Previous 30 days"],
		["thirty-one days ago", at(9, 8, 23, 59), "October"],
		["a month earlier this year", at(0, 15), "January"],
		["a month of last year", at(11, 24, 12, 0, 2025), "December 2025"],
	])("puts %s in %s", (_label, date, label) => {
		expect(dateBucket(date, now).label).toBe(label);
	});

	it("keys months of different years apart", () => {
		expect(dateBucket(at(9, 1, 12, 0, 2025), now).key).not.toBe(
			dateBucket(at(9, 1), now).key,
		);
	});
});

describe("rowTime", () => {
	it.each([
		["the clock today", at(10, 8, 9, 5), "09:05"],
		["the weekday yesterday", at(10, 7, 22, 0), "Sat"],
		["the weekday six days ago", at(10, 2, 0, 0), "Mon"],
		["the day and month seven days ago", at(10, 1), "1 Nov"],
		[
			"the year outside the current one",
			at(11, 24, 12, 0, 2025),
			"24 Dec 2025",
		],
	])("shows %s", (_label, date, text) => {
		expect(rowTime(date, now)).toBe(text);
	});
});
