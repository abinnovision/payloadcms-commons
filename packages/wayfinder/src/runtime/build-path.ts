import { identityFormatHref } from "./build-href.js";
import { isRootWildcard, resolversFor } from "../pattern/resolver.js";

import type { BuildDiagnosticReason, OnDiagnostic } from "./diagnostics.js";
import type {
	FormatHref,
	PayloadCollectionMappingResolved,
} from "../pattern/types.js";

export interface BuildPathArgs {
	mappings: PayloadCollectionMappingResolved[];
	collection: string;
	locale: string;
	/**
	 * Parameter values, either in pattern order or keyed by parameter name.
	 * Positional values let a caller fill a pattern without knowing what its
	 * parameters are called, so renaming one in the CMS needs no code change.
	 */
	values: string[] | Record<string, string>;
	formatHref?: FormatHref;
	onDiagnostic?: OnDiagnostic<BuildDiagnosticReason>;
}

/**
 * Builds a path from parameter values alone, with no document.
 *
 * Sitemaps and feeds run outside a request's rendering context and select only
 * the fields they need, so they never hold a document shaped the way
 * `buildHref` expects. They do hold the values, which is all a pattern needs.
 *
 * An unmapped collection falls back to the site root rather than returning
 * nothing: emitting a bare root into a feed is recoverable, emitting an empty
 * href is not.
 *
 * @param args The mappings, collection, locale and parameter values.
 */
export const buildPath = (args: BuildPathArgs): string => {
	const format = args.formatHref ?? identityFormatHref;
	const root = () => format({ path: "/", locale: args.locale });
	const mapping = args.mappings.find((it) => it.collection === args.collection);

	if (!mapping) {
		args.onDiagnostic?.({
			reason: "no-mapping",
			collection: args.collection,
		});

		return root();
	}

	const resolvers = resolversFor(mapping, args.locale);

	if (!resolvers) {
		args.onDiagnostic?.({
			reason: "no-locale-pattern",
			collection: args.collection,
			locale: args.locale,
		});

		return root();
	}

	const values = args.values;
	const ordered = Array.isArray(values)
		? resolvers.paramNames.map((_, index) => values[index] ?? "")
		: resolvers.paramNames.map((name) => values[name] ?? "");

	if (isRootWildcard(resolvers, ordered)) {
		return root();
	}

	/*
	 * A parameter with no value cannot be compiled into anything meaningful.
	 * `compile` accepts the empty string and drops the segment, so
	 * `/:section/:slug` missing its section becomes "//hello" — a
	 * protocol-relative URL, which resolves against a different host entirely
	 * once a feed or a sitemap makes it absolute. The root is the documented
	 * worst case, and this is the more likely way to reach it than an unmapped
	 * collection.
	 */
	const missing = resolvers.paramNames.find(
		(_, index) => ordered[index] === "",
	);

	if (missing !== undefined) {
		args.onDiagnostic?.({
			reason: "missing-param",
			collection: args.collection,
			param: missing,
		});

		return root();
	}

	const params = Object.fromEntries(
		resolvers.paramNames.map((name, index) => [name, ordered[index] ?? ""]),
	);

	return format({ path: resolvers.build(params), locale: args.locale });
};
