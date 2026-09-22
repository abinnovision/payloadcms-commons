import type { Config } from "payload";

/** The exact shape Payload expects on `config.i18n.translations`. */
type Translations = Exclude<
	NonNullable<Config["i18n"]>["translations"],
	undefined
>;

/**
 * Translation strings the admin components need: the Create option's label
 * and the color field's label. Kept to the two languages the rest of this
 * repo ships (see `apps/example`); a project wanting more merges its own
 * entries in, which is exactly what `mergeTagsTranslations` leaves room for.
 */
const TAGS_TRANSLATIONS: Readonly<
	Record<string, { tags: { create: string; color: string } }>
> = {
	en: { tags: { create: "Create", color: "Color" } },
	de: { tags: { create: "Erstellen", color: "Farbe" } },
};

/**
 * Merges the package's translations into a project's `config.i18n.translations`
 * without overwriting an entry the project already defined for the same
 * language, down to the individual `tags:*` key.
 */
export const mergeTagsTranslations = (
	existing: Translations | undefined,
): Translations => {
	const merged: Record<string, unknown> = { ...existing };

	for (const [language, resource] of Object.entries(TAGS_TRANSLATIONS)) {
		const current =
			(merged[language] as Record<string, unknown> | undefined) ?? {};
		const currentTags =
			(current["tags"] as Record<string, string> | undefined) ?? {};

		merged[language] = {
			...resource,
			...current,
			tags: { ...resource.tags, ...currentTags },
		};
	}

	return merged;
};
