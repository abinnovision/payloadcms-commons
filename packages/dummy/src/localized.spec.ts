import { describe, expect, it } from "vitest";

import { dummyLocalized, expandLocalized } from "./localized.js";

const localization = { defaultLocale: "en", localeCodes: ["en", "de"] };

describe("expandLocalized", () => {
	it("builds the default locale as data and the others as overrides", () => {
		const data = dummyLocalized((t) => ({
			slug: "/",
			title: t({ en: "Home", de: "Start" }),
		}));

		expect(expandLocalized("pages", data, undefined, localization)).toEqual({
			data: { slug: "/", title: "Home" },
			locales: { de: { slug: "/", title: "Start" } },
		});
	});

	it("falls back to the default locale's value", () => {
		const data = dummyLocalized((t) => ({ title: t({ en: "Home" }) }));

		expect(
			expandLocalized("pages", data, undefined, localization).locales,
		).toEqual({ de: { title: "Home" } });
	});

	it("refuses a value missing both its locale and the default", () => {
		const data = dummyLocalized((t) => ({ title: t({ fr: "Accueil" }) }));

		expect(() =>
			expandLocalized("pages", data, undefined, localization),
		).toThrow(/none for the default locale "en"/);
	});

	it("refuses localized data alongside the locales option", () => {
		const data = dummyLocalized(() => ({ title: "x" }));

		expect(() => expandLocalized("pages", data, {}, localization)).toThrow(
			/either dummyLocalized data or the locales option/,
		);
	});

	it("refuses localized data when localization is off", () => {
		const data = dummyLocalized(() => ({ title: "x" }));

		expect(() => expandLocalized("pages", data, undefined, undefined)).toThrow(
			/needs localization enabled/,
		);
	});

	it("passes plain data through unchanged", () => {
		const locales = { de: { title: "Start" } };

		expect(
			expandLocalized("pages", { title: "Home" }, locales, localization),
		).toEqual({ data: { title: "Home" }, locales });
	});
});
