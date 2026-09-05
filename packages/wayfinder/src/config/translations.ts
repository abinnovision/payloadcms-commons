/**
 * Admin-facing messages, keyed for Payload's translation lookup.
 *
 * Registered by the plugin. A project that builds the mapping global directly
 * without the plugin still works — `req.t` returns the key's fallback — but
 * sees these in English regardless of the admin locale.
 */
export const wayfinderTranslations = {
	en: {
		wayfinder: {
			duplicateCollection: "Each collection may only be mapped once",
			duplicatePath: "Two collections may not share the same path pattern",
			invalidPath: "Path is invalid",
			pathUnparseable: "Path could not be parsed as a route pattern",
			pathNeedsParameter: "Path must contain at least one parameter",
			selectCollectionFirst: "Select a collection first",
			unknownCollection: 'Unknown collection "{{value}}". Available: {{known}}',
		},
	},
	de: {
		wayfinder: {
			duplicateCollection: "Jede Collection darf nur einmal zugeordnet werden",
			duplicatePath:
				"Zwei Collections dürfen nicht dasselbe Pfadmuster verwenden",
			invalidPath: "Pfad ist ungültig",
			pathUnparseable: "Pfad konnte nicht als Routenmuster gelesen werden",
			pathNeedsParameter: "Pfad muss mindestens einen Parameter enthalten",
			selectCollectionFirst: "Bitte zuerst eine Collection wählen",
			unknownCollection:
				'Unbekannte Collection "{{value}}". Verfügbar: {{known}}',
		},
	},
} as const;

/** Shape of the translation function Payload hands to a validator. */
export type Translate = (key: string, vars?: Record<string, unknown>) => string;

/**
 * Translates a wayfinder key, falling back to English.
 *
 * Payload returns the key itself when nothing is registered, which would put a
 * bare `wayfinder:invalidPath` in front of an editor. This keeps the English
 * sentence in that case.
 *
 * @param t Payload's translation function, when available.
 * @param key The key within the `wayfinder` namespace.
 * @param vars Interpolation values.
 */
export const translate = (
	t: Translate | undefined,
	key: keyof (typeof wayfinderTranslations)["en"]["wayfinder"],
	vars?: Record<string, string>,
): string => {
	const fallback = wayfinderTranslations.en.wayfinder[key];
	const translated = t?.(`wayfinder:${key}`, vars);

	if (!translated || translated === `wayfinder:${key}`) {
		return Object.entries(vars ?? {}).reduce<string>(
			(acc, [name, value]) => acc.replaceAll(`{{${name}}}`, value),
			fallback,
		);
	}

	return translated;
};
