/**
 * A label that is either one string or a per-language record.
 */
export type LabelLike = string | Record<string, string>;

/**
 * Resolves a label against the admin language.
 *
 * Falls through the request language, then the configured fallback language,
 * then the first entry present. The last step is what keeps a row visible when
 * an admin is opened in a language nobody wrote a label for: showing the
 * label in the wrong language beats showing an empty cell next to a value.
 */
export const resolveLabel = (
	label: LabelLike,
	language: string | undefined,
	fallbackLanguage?: string,
): string | undefined => {
	if (typeof label === "string") {
		return label;
	}

	const candidates = [language, fallbackLanguage].filter(
		(it): it is string => it !== undefined,
	);

	for (const candidate of candidates) {
		const translated = label[candidate];
		if (translated !== undefined && translated !== "") {
			return translated;
		}
	}

	return Object.values(label).find((it) => it !== "");
};
