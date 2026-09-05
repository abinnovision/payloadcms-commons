import type { FormatHref } from "@abinnovision/payloadcms-wayfinder";
import type { TypedLocale } from "payload";

/** Kept in step with `localization` in `payload.config.ts`. */
const LOCALES = ["en", "de"] as const satisfies readonly TypedLocale[];

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

	return first !== undefined && isLocale(first)
		? { locale: first, path: `/${rest.join("/")}` }
		: { locale: DEFAULT_LOCALE, path: `/${segments.join("/")}` };
};

/**
 * Puts the prefix back on every path the site emits.
 *
 * Has to be handed to `buildHref`, `buildPath` **and** `resolveLink`, which
 * calls `buildHref` internally: a link resolved without it would send a
 * visitor from the German site into the English one on the first click.
 */
export const createFormatHref =
	(): FormatHref =>
	({ path, locale }) => {
		const prefix = locale === DEFAULT_LOCALE ? "" : `/${locale}`;

		// The site root arrives as "/", which would otherwise make "/de/".
		return `${prefix}${path === "/" ? "" : path}` || "/";
	};
