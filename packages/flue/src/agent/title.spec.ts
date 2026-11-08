import * as v from "valibot";
import { describe, expect, it } from "vitest";

import { titleSchema } from "./title.js";

describe("titleSchema", () => {
	it("accepts a title of 120 characters", () => {
		expect(v.safeParse(titleSchema, "a".repeat(120)).success).toBe(true);
	});

	it("refuses an empty title", () => {
		expect(v.safeParse(titleSchema, "").success).toBe(false);
	});

	it("refuses a title of 121 characters", () => {
		expect(v.safeParse(titleSchema, "a".repeat(121)).success).toBe(false);
	});
});
