import { describe, expect, it } from "vitest";

import { translateAny, translateStatic, translatorFor } from "./i18n.js";

const EN = { fallbackLanguage: "en", language: "en" };
const DE_EN = { fallbackLanguage: "en", language: "de" };

describe("translateStatic", () => {
	it("passes a plain string through", () => {
		expect(translateStatic("Page title", DE_EN)).toBe("Page title");
	});

	it("prefers the request's language", () => {
		expect(
			translateStatic({ en: "Page title", de: "Seitentitel" }, DE_EN),
		).toBe("Seitentitel");
	});

	it("falls back to the configured fallback language", () => {
		expect(
			translateStatic(
				{ en: "Page title", de: "Seitentitel" },
				{
					fallbackLanguage: "de",
					language: "fr",
				},
			),
		).toBe("Seitentitel");
	});

	it("accepts a list of fallback languages", () => {
		expect(
			translateStatic(
				{ de: "Seitentitel", es: "Titulo" },
				{
					// Payload types this as a string, but resolves lists at runtime.
					fallbackLanguage: ["it", "es"] as unknown as string,
					language: "fr",
				},
			),
		).toBe("Titulo");
	});

	it("falls back to the first declared entry", () => {
		expect(
			translateStatic(
				{ de: "Seitentitel", es: "Titulo" },
				{
					fallbackLanguage: "fr",
					language: "fr",
				},
			),
		).toBe("Seitentitel");
	});

	it("treats an empty value as absent", () => {
		expect(translateStatic("", EN)).toBeUndefined();
		expect(translateStatic({ en: "  ", de: "Seitentitel" }, EN)).toBe(
			"Seitentitel",
		);
		expect(translateStatic({ en: "" }, EN)).toBeUndefined();
		expect(translateStatic({}, EN)).toBeUndefined();
	});

	it("drops anything that is not a string or a string-valued record", () => {
		expect(translateStatic(undefined, EN)).toBeUndefined();
		expect(translateStatic({ en: 1 }, EN)).toBeUndefined();
		expect(
			translateStatic(() => "resolved in the admin UI", EN),
		).toBeUndefined();
		expect(
			translateStatic({ $$typeof: Symbol.for("react.element") }, EN),
		).toBeUndefined();
		expect(translateStatic(["Page title"], EN)).toBeUndefined();
	});
});

describe("translatorFor", () => {
	it("binds a language to the resolution", () => {
		expect(translatorFor(DE_EN)({ en: "Page title", de: "Seitentitel" })).toBe(
			"Seitentitel",
		);
	});
});

describe("translateAny", () => {
	it("takes the first entry, having no language to go on", () => {
		expect(translateAny({ de: "Seitentitel", en: "Page title" })).toBe(
			"Seitentitel",
		);
	});
});
