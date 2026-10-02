import { describe, expect, it } from "vitest";

import { errorResult, jsonResult } from "./result.js";

describe("jsonResult and errorResult", () => {
	it("serializes a value as JSON text", () => {
		const result = jsonResult({ a: 1 });

		expect(result.isError).toBeUndefined();
		expect(result.content).toEqual([{ type: "text", text: '{"a":1}' }]);
	});

	it("marks an error result and carries extras", () => {
		const result = errorResult("nope", { problems: ["x"] });

		expect(result.isError).toBe(true);
		expect(result.content).toEqual([
			{ type: "text", text: '{"error":"nope","problems":["x"]}' },
		]);
	});
});
