import { resolversFor } from "./resolver.js";

import type {
	PayloadCollectionMappingMatch,
	PayloadCollectionMappingResolved,
	PayloadCollectionMappingResolvers,
} from "./types.js";

interface MatchOpts {
	path: string;
	locale: string;
	mappings: PayloadCollectionMappingResolved[];
}

export type PayloadCollectionMatch = {
	mapping: PayloadCollectionMappingResolved;
} & PayloadCollectionMappingMatch;

/**
 * A mapping paired with the resolvers for the locale being matched.
 *
 * Resolved once up front so the locale fallback lives in one place and every
 * later step works with resolvers that are known to exist.
 */
interface Candidate {
	mapping: PayloadCollectionMappingResolved;
	resolvers: PayloadCollectionMappingResolvers;
}

/**
 * Orders two candidates most-specific first.
 *
 * Literal segments win outright, so `/journal/:slug` beats `/:section/:slug`
 * for `/journal/first-post`. Failing that, a catch-all yields to a fixed-arity
 * pattern. Length breaks the remaining ties, and the collection name breaks
 * the last one: two collections may legally hold the same pattern, and
 * without a final tiebreak the winner would be whichever row an editor
 * happened to drag higher.
 */
const bySpecificity = (a: Candidate, b: Candidate): number => {
	const left = a.resolvers.specificity;
	const right = b.resolvers.specificity;

	if (left.literalSegments !== right.literalSegments) {
		return right.literalSegments - left.literalSegments;
	}

	if (left.hasWildcard !== right.hasWildcard) {
		return left.hasWildcard ? 1 : -1;
	}

	if (left.totalSegments !== right.totalSegments) {
		return right.totalSegments - left.totalSegments;
	}

	return a.mapping.collection.localeCompare(b.mapping.collection);
};

/**
 * Resolves the site root. A wildcard pattern cannot match `/` — path-to-regexp
 * requires at least one segment — so the collection whose pattern is a bare
 * catch-all owns it, identified by an empty path.
 *
 * @param opts The path, locale and candidate mappings.
 */
const matchRoot = (opts: MatchOpts): PayloadCollectionMatch | undefined => {
	for (const mapping of opts.mappings) {
		const resolvers = resolversFor(mapping, opts.locale);

		if (
			!resolvers ||
			!resolvers.specificity.hasWildcard ||
			resolvers.specificity.literalSegments > 0 ||
			resolvers.specificity.totalSegments !== 1
		) {
			continue;
		}

		const field = resolvers.paramNames[0];

		if (!field) {
			continue;
		}

		return { mapping, identifier: { field, value: "/" }, scope: {} };
	}

	return undefined;
};

/**
 * Finds every collection a path could belong to, most specific first.
 *
 * More than one pattern can match the same path: `/legal/imprint` fits both
 * `/:section/:slug` and a wildcard. Returning all of them lets the caller fall
 * through to the next candidate when the first yields no document, instead of
 * 404ing on a page that exists.
 *
 * Ordering is by specificity rather than by the order rows happen to sit in
 * the CMS, so resolution stays deterministic.
 *
 * @param opts The path, locale and candidate mappings.
 */
export const matchCollectionMappings = (
	opts: MatchOpts,
): PayloadCollectionMatch[] => {
	if (opts.path === "/") {
		const root = matchRoot(opts);

		return root ? [root] : [];
	}

	return opts.mappings
		.flatMap((mapping): Candidate[] => {
			const resolvers = resolversFor(mapping, opts.locale);

			return resolvers ? [{ mapping, resolvers }] : [];
		})
		.sort(bySpecificity)
		.flatMap(({ mapping, resolvers }) => {
			const matched = resolvers.match(opts.path);

			return matched ? [{ mapping, ...matched }] : [];
		});
};
