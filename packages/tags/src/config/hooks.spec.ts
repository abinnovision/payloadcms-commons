import { describe, expect, it } from "vitest";

import { colorFillHook } from "./hooks.js";
import { colorForName } from "../index.js";

type HookArgs = Parameters<typeof colorFillHook>[0];

/** The hook reads only `data` and `originalDoc`; the rest of its args stay empty. */
const run = (
	data: Record<string, unknown>,
	originalDoc?: NonNullable<HookArgs["originalDoc"]>,
) => {
	const args: Partial<HookArgs> = originalDoc
		? { data, originalDoc, operation: "update" }
		: { data, operation: "create" };

	return colorFillHook(args as HookArgs) as Record<string, unknown>;
};

describe("colorFillHook", () => {
	it("fills a missing color from the name", () => {
		expect(run({ name: "News" })["color"]).toBe(colorForName("News"));
	});

	it("leaves an explicit color untouched", () => {
		expect(run({ name: "News", color: "#123456" })["color"]).toBe("#123456");
	});

	it("does nothing when the name is missing", () => {
		expect(run({})["color"]).toBeUndefined();
	});

	it("keeps the original color on a partial update that omits it", () => {
		const result = run(
			{ name: "News" },
			{ id: 1, name: "News", color: "#123456" },
		);

		expect(result["color"]).toBeUndefined();
	});

	it("refills the color from the original name on a partial update without a name", () => {
		const result = run(
			{ color: null },
			{ id: 1, name: "News", color: "#123456" },
		);

		expect(result["color"]).toBe(colorForName("News"));
	});
});
