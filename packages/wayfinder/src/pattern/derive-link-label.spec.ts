import { describe, expect, it } from "vitest";

import { defineLinks } from "./define-links.js";
import { deriveLinkLabel } from "./derive-link-label.js";

describe("deriveLinkLabel", () => {
	it("uses the raw URL for a custom link", () => {
		expect(
			deriveLinkLabel({ type: "custom", url: "https://example.com" }),
		).toBe("https://example.com");
	});

	it("returns undefined for a custom link with no URL yet", () => {
		expect(deriveLinkLabel({ type: "custom" })).toBeUndefined();
	});

	it("describes a populated reference as collection and id", () => {
		expect(
			deriveLinkLabel({
				type: "reference",
				reference: { relationTo: "articles", value: { id: "abc123" } },
			}),
		).toBe("articles/abc123");
	});

	// A capped relationship depth leaves a bare id, which still names a target.
	it("describes a bare-id reference the same way", () => {
		expect(
			deriveLinkLabel({
				type: "reference",
				reference: { relationTo: "pages", value: "abc123" },
			}),
		).toBe("pages/abc123");
	});

	it("returns undefined for a reference with nothing selected", () => {
		expect(deriveLinkLabel({ type: "reference" })).toBeUndefined();
	});

	it("prefixes a same-page identifier with a hash", () => {
		expect(
			deriveLinkLabel({ type: "same-page", samePageIdentifier: "contact" }),
		).toBe("#contact");
	});

	it("returns undefined for a same-page link with no identifier", () => {
		expect(deriveLinkLabel({ type: "same-page" })).toBeUndefined();
	});

	it("returns undefined for an explicit `none`", () => {
		expect(deriveLinkLabel({ type: "none" })).toBeUndefined();
	});

	it("returns undefined for an unset type", () => {
		expect(deriveLinkLabel({})).toBeUndefined();
	});

	it("returns undefined for a null type", () => {
		expect(deriveLinkLabel({ type: null })).toBeUndefined();
	});

	/*
	 * The package cannot describe a variant's own fields, so the variant's
	 * value is the most it can say without knowing them.
	 */
	it("falls back to an app-declared variant's own value", () => {
		const links = defineLinks()(() => ({
			variants: { download: { label: "Download" } },
		}));

		expect(deriveLinkLabel({ type: "download" }, { links })).toBe("download");
	});

	it("returns undefined for a type no variant declares", () => {
		expect(deriveLinkLabel({ type: "download" }, {})).toBeUndefined();
	});
});
