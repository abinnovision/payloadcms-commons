import { describe, expect, it } from "vitest";

import { PATCH_OPERATION_SCHEMA } from "./patch-document.js";

describe("pATCH_OPERATION_SCHEMA", () => {
	it("accepts the six RFC 6902 operations", () => {
		const operations = [
			{ op: "add", path: "/a", value: 1 },
			{ from: "/b", op: "copy", path: "/a" },
			{ from: "/b", op: "move", path: "/a" },
			{ op: "remove", path: "/a" },
			{ op: "replace", path: "/a", value: 1 },
			{ op: "test", path: "/a", value: 1 },
		];

		for (const operation of operations) {
			expect(PATCH_OPERATION_SCHEMA.safeParse(operation).success).toBe(true);
		}
	});

	it("rejects an unknown operation", () => {
		expect(
			PATCH_OPERATION_SCHEMA.safeParse({ op: "set", path: "/a" }).success,
		).toBe(false);
	});

	it("rejects members the operation does not take", () => {
		expect(
			PATCH_OPERATION_SCHEMA.safeParse({
				from: "/b",
				op: "copy",
				path: "/a",
				value: 1,
			}).success,
		).toBe(false);

		expect(
			PATCH_OPERATION_SCHEMA.safeParse({ from: "/b", op: "add", path: "/a" })
				.success,
		).toBe(false);
	});

	it("requires a source pointer on copy and move", () => {
		expect(
			PATCH_OPERATION_SCHEMA.safeParse({ op: "copy", path: "/a" }).success,
		).toBe(false);
	});
});
