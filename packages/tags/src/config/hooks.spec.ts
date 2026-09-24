import { describe, expect, it } from "vitest";

import { createColorFillHook } from "./hooks.js";

import type { CollectionBeforeChangeHook } from "payload";

const collection = {
	slug: "tags",
} as unknown as Parameters<CollectionBeforeChangeHook>[0]["collection"];

describe("createColorFillHook", () => {
	const hook = createColorFillHook("name");
	const run = (
		data: Record<string, unknown>,
		originalDoc?: Record<string, unknown>,
	) =>
		hook({
			collection,
			context: {},
			data,
			operation: originalDoc ? "update" : "create",
			originalDoc,
			req: {} as unknown as Parameters<CollectionBeforeChangeHook>[0]["req"],
		} as unknown as Parameters<CollectionBeforeChangeHook>[0]);

	it("fills a missing color from the title", () => {
		const result = run({ name: "News" });

		expect(result["color"]).toBeTypeOf("string");
	});

	it("leaves an explicit color untouched", () => {
		const result = run({ name: "News", color: "#123456" });

		expect(result["color"]).toBe("#123456");
	});

	it("does nothing when the title is missing", () => {
		const result = run({});

		expect(result["color"]).toBeUndefined();
	});

	it("does not overwrite the original document's color on a partial update that omits it", () => {
		const result = run({ name: "News" }, { name: "News", color: "#123456" });

		expect(result["color"]).toBeUndefined();
	});
});
