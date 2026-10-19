import { describe, expect, it } from "vitest";

import { LOCALES, createFormatHref, splitLocale } from "./locales";

const formatHref = createFormatHref();

describe("the locale prefix", () => {
	/*
	 * These two are inverses, and the only thing keeping them so is this test.
	 * The prefix is the app's, not the mapping's: `splitLocale` takes it off an
	 * incoming path before wayfinder matches, and `formatHref` puts it back on
	 * every path wayfinder builds. A disagreement between them is a link that
	 * resolves into the wrong locale, which is invisible until someone clicks.
	 */
	const paths = ["/", "/about", "/about/team", "/journal/hello-world"];

	for (const locale of LOCALES) {
		for (const path of paths) {
			it(`round-trips ${path} in ${locale}`, () => {
				const href = formatHref({ path, locale });
				const segments = href.split("/").filter(Boolean);

				expect(splitLocale(segments)).toEqual({ locale, path });
			});
		}
	}

	/*
	 * The site root is the case that breaks first, and the reason this file
	 * exists: a naive prefix builds "/de/", which no pattern matches because
	 * trailing slashes are not normalised anywhere.
	 */
	it("does not leave a trailing slash on a prefixed root", () => {
		expect(formatHref({ path: "/", locale: "de" })).toBe("/de");
	});

	it("leaves the default locale unprefixed", () => {
		expect(formatHref({ path: "/about", locale: "en" })).toBe("/about");
	});

	/*
	 * `/en/about` would otherwise be a second URL for a document already
	 * served at `/about`, with nothing pointing one at the other.
	 */
	it("does not answer to the default locale as a prefix", () => {
		expect(splitLocale(["en", "about"])).toEqual({
			locale: "en",
			path: "/en/about",
		});
	});
});
