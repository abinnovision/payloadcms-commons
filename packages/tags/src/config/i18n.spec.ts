import { describe, expect, it } from "vitest";

import { mergeTagsTranslations } from "./i18n.js";

describe("mergeTagsTranslations", () => {
	it("adds the package's translations when none exist", () => {
		const merged = mergeTagsTranslations(undefined);

		expect(merged["en"]).toMatchObject({
			tags: { create: "Create", color: "Color" },
		});
		expect(merged["de"]).toMatchObject({
			tags: { create: "Erstellen", color: "Farbe" },
		});
	});

	it("keeps a project's own translations for the same language and key", () => {
		const merged = mergeTagsTranslations({
			en: { tags: { create: "Add" }, other: { key: "value" } },
		});

		expect(merged["en"]).toMatchObject({
			tags: { create: "Add", color: "Color" },
			other: { key: "value" },
		});
	});

	it("leaves an unrelated language's translations untouched", () => {
		const merged = mergeTagsTranslations({ fr: { greeting: "Bonjour" } });

		expect(merged["fr"]).toEqual({ greeting: "Bonjour" });
		expect(merged["en"]).toBeDefined();
	});
});
