import * as ptr from "path-to-regexp";

import { DEFAULT_IDENTIFIER_FIELD, DEFAULT_LOCALE_KEY } from "./types.js";

import type {
	PayloadCollectionMapping,
	PayloadCollectionMappingMatch,
	PayloadCollectionMappingResolved,
	PayloadCollectionMappingResolvers,
	PayloadCollectionMappingSpecificity,
} from "./types.js";
import type { Key, ParamData } from "path-to-regexp";

/**
 * A wildcard stands for a whole path, so its value carries a leading slash to
 * match how full paths are stored — a wildcard-mapped collection's identifier
 * is `/about/team`, not `about/team`.
 *
 * @param value Raw parameter value from path-to-regexp.
 * @param isWildcard Whether the parameter was declared as a wildcard.
 */
const normaliseValue = (value: unknown, isWildcard: boolean): string => {
	let joined = "";

	if (Array.isArray(value)) {
		joined = value.filter((it) => typeof it === "string").join("/");
	} else if (typeof value === "string") {
		joined = value;
	}

	if (!isWildcard) {
		return joined;
	}

	return joined.startsWith("/") ? joined : `/${joined}`;
};

/**
 * Reverses {@link normaliseValue} so a stored full path can be fed back into
 * `compile`, which requires a non-empty array for a wildcard.
 *
 * @param value The parameter value to convert.
 */
const denormaliseWildcard = (value: unknown): string[] =>
	(typeof value === "string" ? value : "").split("/").filter(Boolean);

const measureSpecificity = (
	pattern: string,
	keys: Key[],
): PayloadCollectionMappingSpecificity => {
	const segments = pattern.split("/").filter(Boolean);

	return {
		literalSegments: segments.filter(
			(segment) => !segment.startsWith(":") && !segment.startsWith("*"),
		).length,
		hasWildcard: keys.some((key) => key.type === "wildcard"),
		totalSegments: segments.length,
	};
};

const createResolvers = (
	pattern: string,
): PayloadCollectionMappingResolvers => {
	const { keys } = ptr.pathToRegexp(pattern);
	const matchFn = ptr.match(pattern);
	const buildFn = ptr.compile(pattern);
	const wildcardNames = new Set(
		keys.filter((key) => key.type === "wildcard").map((key) => key.name),
	);

	return {
		specificity: measureSpecificity(pattern, keys),
		paramNames: keys.map((key) => key.name),
		match: (path: string): false | PayloadCollectionMappingMatch => {
			const matched = matchFn(path);

			if (!matched) {
				return false;
			}

			/*
			 * Ordering follows the pattern's keys rather than the params
			 * object, so the last parameter is reliably the identifying one.
			 */
			const ordered = keys.map((key) => {
				const name = key.name;

				return {
					name,
					value: normaliseValue(
						(matched.params as Record<string, unknown>)[name],
						wildcardNames.has(name),
					),
				};
			});

			const identifying = ordered.at(-1);

			if (!identifying || !identifying.value) {
				return false;
			}

			return {
				identifier: { field: identifying.name, value: identifying.value },
				scope: Object.fromEntries(
					ordered.slice(0, -1).map((it) => [it.name, it.value]),
				),
			};
		},
		build: (params: ParamData) =>
			buildFn(
				Object.fromEntries(
					Object.entries(params).map(([name, value]) => [
						name,
						wildcardNames.has(name) ? denormaliseWildcard(value) : value,
					]),
				),
			),
	};
};

/**
 * Normalises the two shapes a mapping's `path` can take.
 *
 * A localized project yields one pattern per locale. A project with no
 * `localization` block yields a plain string, which would otherwise be walked
 * character by character by `Object.entries` and compile into one nonsense
 * resolver per character.
 *
 * @param path The pattern, or per-locale patterns.
 */
const normalisePath = (
	path: string | Record<string, string>,
): Record<string, string> =>
	typeof path === "string" ? { [DEFAULT_LOCALE_KEY]: path } : path;

/**
 * Whether a wildcard pattern was handed the site root. `compile` rejects an
 * empty wildcard, so the home page — a document whose identifier is just `/` —
 * has to be built as the bare root instead.
 *
 * @param resolvers The pattern's compiled resolvers.
 * @param values The parameter values, in pattern order.
 */
export const isRootWildcard = (
	resolvers: PayloadCollectionMappingResolvers,
	values: string[],
): boolean =>
	resolvers.specificity.hasWildcard &&
	values.every((value) => value === "" || value === "/");

/**
 * Picks the resolvers for a locale, falling back to the unlocalized bucket.
 *
 * A project without localization has exactly one bucket under
 * {@link DEFAULT_LOCALE_KEY}, so callers pass whatever locale they have and
 * still get the right pattern.
 *
 * @param mapping The compiled mapping.
 * @param locale The locale to resolve for.
 */
export const resolversFor = (
	mapping: PayloadCollectionMappingResolved,
	locale: string,
): PayloadCollectionMappingResolvers | undefined =>
	mapping.resolvers[locale] ?? mapping.resolvers[DEFAULT_LOCALE_KEY];

/**
 * Compiles a mapping's patterns into match and build functions.
 *
 * @param input The mapping as authored.
 * @param fallbackIdentifierField The field a relationship parameter falls back
 *   to when the target's own pattern cannot name one.
 */
export const resolveCollectionMapping = (
	input: PayloadCollectionMapping,
	fallbackIdentifierField: string = DEFAULT_IDENTIFIER_FIELD,
): PayloadCollectionMappingResolved => {
	const path = normalisePath(input.path);

	return {
		collection: input.collection,
		fallbackIdentifierField,
		path,
		resolvers: Object.fromEntries(
			Object.entries(path).map(([locale, pattern]) => [
				locale,
				createResolvers(pattern),
			]),
		),
	};
};
