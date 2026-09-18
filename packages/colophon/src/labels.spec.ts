import { describe, expect, it } from "vitest";

import { resolveLabel } from "./labels.js";

describe("resolveLabel", () => {
	it("passes a plain string through untouched", () => {
		expect(resolveLabel("Version", "de")).toBe("Version");
	});

	it("picks the entry for the request language", () => {
		expect(resolveLabel({ de: "Fassung", en: "Version" }, "de")).toBe(
			"Fassung",
		);
	});

	it("falls back to the configured fallback language", () => {
		expect(resolveLabel({ en: "Version" }, "fr", "en")).toBe("Version");
	});

	/*
	 * An admin opened in a language nobody wrote a label for still has to show
	 * something beside the value, so the last resort is any entry at all.
	 */
	it("falls back to the first entry when neither language is present", () => {
		expect(resolveLabel({ de: "Fassung" }, "fr", "en")).toBe("Fassung");
	});

	it("skips empty entries rather than rendering a blank label", () => {
		expect(resolveLabel({ de: "", en: "Version" }, "de", "en")).toBe("Version");
	});

	it("resolves to nothing when the record is empty", () => {
		expect(resolveLabel({}, "en", "en")).toBeUndefined();
	});
});
