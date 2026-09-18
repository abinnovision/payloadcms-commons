import { describe, expect, it } from "vitest";

import { shortSha } from "./format.js";

describe("shortSha", () => {
	it("abbreviates a full sha to seven characters", () => {
		expect(shortSha("8f079ec2a1b3c4d5e6f708192a3b4c5d6e7f8091")).toBe(
			"8f079ec",
		);
	});

	it("leaves a sha that is already short alone", () => {
		expect(shortSha("8f079ec")).toBe("8f079ec");
	});

	/*
	 * The case the guard exists for: truncating this would produce another
	 * version number that is just as plausible and entirely wrong.
	 */
	it("leaves a version tag alone", () => {
		expect(shortSha("v1.12.30")).toBe("v1.12.30");
	});

	it("leaves a value too short to be a sha alone", () => {
		expect(shortSha("abc")).toBe("abc");
	});

	it("leaves a version-plus-sha string alone", () => {
		expect(shortSha("v1.2.3-8f079ec")).toBe("v1.2.3-8f079ec");
	});
});
