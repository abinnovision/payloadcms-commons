import { fail } from "./errors.js";

import type { DummyLocalizedData, DummyTranslate } from "./types.js";

/* A string brand, like a ref's, so the marker is recognised structurally. */
const BRAND = "__dummyLocalized";

/** The locales a run writes, read from the Payload config. */
export interface DummyLocalization {
	defaultLocale: string;
	localeCodes: readonly string[];
}

/**
 * Builds a document's or global's data once per configured locale, so every
 * locale comes from the same structure and its arrays line up by construction.
 *
 * @param build Answers the data, picking each localized value with `t`.
 */
export const dummyLocalized = <T>(
	build: (t: DummyTranslate) => T,
): DummyLocalizedData<T> => ({ [BRAND]: build });

/** Whether a value was built by {@link dummyLocalized}. */
export const isDummyLocalized = (
	value: unknown,
): value is DummyLocalizedData<unknown> =>
	typeof value === "object" &&
	value !== null &&
	typeof (value as Record<string, unknown>)[BRAND] === "function";

/**
 * Answers a `t` for one locale, falling back to the default locale's value.
 *
 * @param subject How the target reads in a message, such as `pages`.
 * @param locale The locale being built.
 * @param defaultLocale The locale to fall back to.
 */
const createTranslate =
	(subject: string, locale: string, defaultLocale: string): DummyTranslate =>
	<V>(values: Partial<Record<string, V>>): V =>
		values[locale] ??
		values[defaultLocale] ??
		fail(
			`${subject}: a localized value has none for "${locale}" and none for ` +
				`the default locale "${defaultLocale}", which every locale falls ` +
				"back to.",
		);

/**
 * Expands localized data into the default locale's data and one override per
 * other locale. Anything else passes through unchanged.
 *
 * @param subject How the target reads in a message, such as `pages`.
 * @param data The data as the seed passed it.
 * @param locales The `locales` option as the seed passed it.
 * @param localization The run's locales, undefined when localization is off.
 */
export const expandLocalized = (
	subject: string,
	data: unknown,
	locales: Record<string, unknown> | undefined,
	localization: DummyLocalization | undefined,
): { data: unknown; locales: Record<string, unknown> | undefined } => {
	if (!isDummyLocalized(data)) {
		return { data, locales };
	}

	if (localization === undefined) {
		return fail(
			`${subject}: dummyLocalized needs localization enabled in the Payload ` +
				"config.",
		);
	}

	if (locales !== undefined) {
		return fail(
			`${subject}: pass either dummyLocalized data or the locales option, ` +
				"not both.",
		);
	}

	const { defaultLocale, localeCodes } = localization;
	const build = (locale: string): unknown =>
		data.__dummyLocalized(createTranslate(subject, locale, defaultLocale));

	return {
		data: build(defaultLocale),
		locales: Object.fromEntries(
			localeCodes
				.filter((locale) => locale !== defaultLocale)
				.map((locale) => [locale, build(locale)]),
		),
	};
};
