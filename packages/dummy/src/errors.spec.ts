import { ValidationError } from "payload";
import { describe, expect, it } from "vitest";

import { decorate, describeError, errorPaths, fail } from "./errors.js";

const validation = (): ValidationError =>
	new ValidationError({
		collection: "pages",
		errors: [
			{ label: "Section", message: "This field is required.", path: "section" },
		],
	});

describe("fail", () => {
	it("throws prefixed, so the message names its source", () => {
		expect(() => fail("nope")).toThrow("[payloadcms-dummy] nope");
	});
});

describe("describeError", () => {
	it("unwraps a validation error into path and message pairs", () => {
		expect(describeError(validation())).toBe(
			"validation failed, section: This field is required.",
		);
	});

	it("answers an ordinary error's message", () => {
		expect(describeError(new Error("boom"))).toBe("boom");
	});

	it("stringifies a thrown non-error", () => {
		expect(describeError("boom")).toBe("boom");
	});
});

describe("errorPaths", () => {
	it("answers the field paths a validation error complains about", () => {
		expect(errorPaths(validation())).toEqual(["section"]);
	});

	it("answers nothing for an ordinary error", () => {
		expect(errorPaths(new Error("boom"))).toEqual([]);
	});
});

describe("decorate", () => {
	it("names the document and keeps the original as cause", () => {
		const original = validation();

		expect(() => decorate('pages "/about"', original)).toThrow(
			'pages "/about": validation failed, section: This field is required.',
		);

		const thrown = ((): unknown => {
			try {
				return decorate('pages "/about"', original);
			} catch (error) {
				return error;
			}
		})();

		expect((thrown as Error).cause).toBe(original);
	});

	it("uses a hint in place of the description when one is given", () => {
		expect(() => decorate("pages", new Error("boom"), "explained")).toThrow(
			"pages: explained",
		);
	});
});
