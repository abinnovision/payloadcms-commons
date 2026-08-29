import { describe, expect, it } from "vitest";

import { errorResult, jsonResult } from "./result.js";

const parse = (result: { content: { type: string; text?: string }[] }) =>
	JSON.parse(result.content[0]?.text ?? "null") as Record<string, unknown>;

describe("result helpers", () => {
	it("serializes a value as JSON text", () => {
		const result = jsonResult({ a: 1 });

		expect(result.isError).toBeUndefined();
		expect(parse(result)).toEqual({ a: 1 });
	});

	it("marks an error result and carries extras", () => {
		const result = errorResult("nope", { problems: ["x"] });

		expect(result.isError).toBe(true);
		expect(parse(result)).toEqual({ error: "nope", problems: ["x"] });
	});
});
