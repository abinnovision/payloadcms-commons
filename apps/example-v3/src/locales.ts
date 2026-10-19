import type { FormatHref } from "@abinnovision/payloadcms-wayfinder";
import type { TypedLocale } from "payload";

/** Kept in step with `localization` in `payload.config.ts`. */
export const LOCALES = ["en", "de"] as const satisfies readonly TypedLocale[];

const DEFAULT_LOCALE: TypedLocale = "en";

const isLocale = (value: string): value is TypedLocale =>
	(LOCALES as readonly string[]).includes(value);

/**
 * Splits a request path into the locale it names and the path the mapping
 * sees.
 *
 * The prefix is the app's, not the mapping's. Authoring it into the patterns
 * instead would work for every path but one: a wildcard pattern cannot match
 * an empty rest, so `/de` could never reach the German home page.
 * `resolvePathToDocument` expects the locale already stripped.
 */
export const splitLocale = (
	segments: string[],
): { locale: TypedLocale; path: string } => {
	const [first, ...rest] = segments;

	/*
	 * The default locale is deliberately not a prefix it answers to. Emitting
	 * `/about` and also serving `/en/about` would be two URLs for one
	 * document, which is what the canonical tag exists to prevent — better not
	 * to create the duplicate in the first place.
	 */
	return first !== undefined && first !== DEFAULT_LOCALE && isLocale(first)
		? { locale: first, path: `/${rest.join("/")}` }
		: { locale: DEFAULT_LOCALE, path: `/${segments.join("/")}` };
};

/**
 * Puts the prefix back on every path the site emits.
 *
 * Handed to `createRouter` once per request, so every href, path and link that
 * router produces carries the prefix. Passing it to each call separately was
 * how a link ended up resolving into the wrong locale: the one call that
 * forgot it sent a visitor from the German site into the English one.
 *
 * The inverse of {@link splitLocale}, and tested as such.
 */
export const createFormatHref =
	(): FormatHref =>
	({ path, locale }) => {
		const prefix = locale === DEFAULT_LOCALE ? "" : `/${locale}`;

		// The site root arrives as "/", which would otherwise make "/de/".
		return `${prefix}${path === "/" ? "" : path}` || "/";
	};
