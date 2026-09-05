import { resolversFor } from "./resolver.js";
import { DEFAULT_IDENTIFIER_FIELD } from "./types.js";

import type { PayloadCollectionMappingResolved } from "./types.js";
import type { SanitizedCollectionConfig } from "payload";

export type RegisteredCollections = Record<
	string,
	{ config: SanitizedCollectionConfig } | undefined
>;

export interface ResolveParamQueryPathArgs {
	/** The collection the mapping belongs to. */
	config: SanitizedCollectionConfig;
	/** The parameter name taken from the path pattern. */
	param: string;
	/** Every registered collection, for following relationships. */
	collections: RegisteredCollections;
	/**
	 * The compiled mappings, when available. Supplying them lets a
	 * relationship's identifier field be derived from the target collection's
	 * own pattern instead of assumed.
	 */
	mappings?: PayloadCollectionMappingResolved[];
	/** The locale to derive against; patterns may differ per locale. */
	locale?: string;
	/**
	 * Fallback when the target's identifier cannot be derived and the target
	 * has no compiled mapping to read one off. Used at save time, where the
	 * mappings do not exist yet.
	 */
	fallbackIdentifierField?: string;
}

/**
 * Works out which field of a related collection a parameter matches on.
 *
 * The target's own pattern already names it: the last parameter of the pattern
 * a collection is served at is, by definition, what identifies its documents.
 * Deriving it means a project keyed by `permalink` or `handle` needs no
 * configuration, and cannot drift out of sync with its own routes.
 *
 * A wildcard target is excluded on purpose. Its stored value carries a leading
 * slash, while the value arriving from a match is a bare segment, so a query
 * built from it would never match — and would fail as an empty result rather
 * than as an error.
 *
 * @param target The related collection's slug.
 * @param args The resolution arguments.
 */
const deriveIdentifierField = (
	target: string,
	args: ResolveParamQueryPathArgs,
): string => {
	const mapping = args.mappings?.find((it) => it.collection === target);
	/*
	 * The explicit argument wins. A compiled mapping always carries a
	 * `fallbackIdentifierField`, so reading it first would make the argument
	 * unreachable whenever the target happens to be mapped — silently, and
	 * only for some targets.
	 */
	const fallback =
		args.fallbackIdentifierField ??
		mapping?.fallbackIdentifierField ??
		DEFAULT_IDENTIFIER_FIELD;

	if (!mapping || args.locale === undefined) {
		return fallback;
	}

	const resolvers = resolversFor(mapping, args.locale);

	if (!resolvers || resolvers.specificity.hasWildcard) {
		return fallback;
	}

	return resolvers.paramNames.at(-1) ?? fallback;
};

/**
 * Resolves a path parameter to the query path it filters on.
 *
 * A parameter naming a plain field filters that field directly. A parameter
 * naming a relationship filters the related document's identifier, so
 * `:section` becomes `section.slug` for a target keyed by `slug`.
 *
 * @param args The collection, parameter and resolution context.
 */
export const resolveParamQueryPath = (
	args: ResolveParamQueryPathArgs,
): { queryPath: string } | { error: string } => {
	const field = args.config.flattenedFields.find(
		(it) => it.name === args.param,
	);

	if (!field) {
		return {
			error: `Collection "${args.config.slug}" does not define a field named "${args.param}"`,
		};
	}

	if (field.type !== "relationship") {
		return { queryPath: args.param };
	}

	const targets = Array.isArray(field.relationTo)
		? field.relationTo
		: [field.relationTo];

	const identifiers = new Set<string>();
	let identifier = args.fallbackIdentifierField ?? DEFAULT_IDENTIFIER_FIELD;

	for (const target of targets) {
		const targetConfig = args.collections[target]?.config;

		identifier = deriveIdentifierField(target, args);

		if (!targetConfig?.flattenedFields.some((it) => it.name === identifier)) {
			return {
				error: `Relationship "${args.param}" points at "${target}", which has no "${identifier}" field to match on`,
			};
		}

		identifiers.add(identifier);
	}

	/*
	 * A polymorphic relationship can derive a different identifier per target,
	 * and one query path cannot express two. Refusing at validation time is
	 * better than silently matching on whichever target came first.
	 */
	if (identifiers.size > 1) {
		return {
			error: `Relationship "${args.param}" points at collections identified by different fields (${[...identifiers].sort().join(", ")}), which cannot be matched in one query`,
		};
	}

	return { queryPath: `${args.param}.${identifier}` };
};
