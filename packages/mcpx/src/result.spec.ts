import { describe, expect, it } from "vitest";

import { errorResult, jsonResult } from "./result.js";
import { parseResult } from "../test/result.js";

describe("jsonResult and errorResult", () => {
	it("serializes a value as JSON text", () => {
		const result = jsonResult({ a: 1 });

		expect(result.isError).toBeUndefined();
		expect(parseResult(result)).toEqual({ a: 1 });
	});

	it("marks an error result and carries extras", () => {
		const result = errorResult("nope", { problems: ["x"] });

		expect(result.isError).toBe(true);
		expect(parseResult(result)).toEqual({ error: "nope", problems: ["x"] });
	});
});
