import { resolversFor } from "../pattern/resolver.js";

import type { BuildDiagnosticReason, OnDiagnostic } from "./diagnostics.js";
import type {
	FormatHref,
	PayloadCollectionMappingResolved,
} from "../pattern/types.js";

/**
 * A document as it arrives on a populated relationship.
 *
 * Typed as a plain object rather than an indexed record so generated
 * collection interfaces assign to it; the fields the path pattern names are
 * read dynamically below.
 */
export type LinkableDocument = object;

/** Applied when no {@link FormatHref} is supplied: the path, untouched. */
export const identityFormatHref: FormatHref = ({ path }) => path;

/**
 * Reads the value a path parameter needs off a document.
 *
 * A plain field yields its own value; a populated relationship yields the
 * related document's identifier, which is what the query matches on.
 *
 * @param document The document being linked to.
 * @param param The path parameter name.
 * @param identifierField The related document's identifying field.
 */
const readParam = (
	document: LinkableDocument,
	param: string,
	identifierField: string,
): string | undefined => {
	const value = (document as Record<string, unknown>)[param];

	if (typeof value === "string") {
		return value;
	}

	if (value && typeof value === "object" && identifierField in value) {
		const identifier = (value as Record<string, unknown>)[identifierField];

		return typeof identifier === "string" ? identifier : undefined;
	}

	return undefined;
};

export interface BuildHrefArgs {
	mappings: PayloadCollectionMappingResolved[];
	collection: string;
	document: LinkableDocument;
	locale: string;
	formatHref?: FormatHref;
	onDiagnostic?: OnDiagnostic<BuildDiagnosticReason>;
}

/**
 * Builds the href a document is served at, using its collection's pattern.
 *
 * Returns null when the collection has no mapping or the document is missing a
 * value the pattern needs — a relationship left unpopulated is the usual
 * cause, so check `defaultPopulate` before assuming the mapping is wrong.
 *
 * @param args The mappings, target collection, document and locale.
 */
export const buildHref = (args: BuildHrefArgs): string | null => {
	const format = args.formatHref ?? identityFormatHref;
	const mapping = args.mappings.find((it) => it.collection === args.collection);

	if (!mapping) {
		args.onDiagnostic?.({
			reason: "no-mapping",
			collection: args.collection,
		});

		return null;
	}

	const resolvers = resolversFor(mapping, args.locale);

	if (!resolvers) {
		args.onDiagnostic?.({
			reason: "no-locale-pattern",
			collection: args.collection,
			locale: args.locale,
		});

		return null;
	}

	const params: Record<string, string> = {};

	for (const name of resolvers.paramNames) {
		const value = readParam(
			args.document,
			name,
			mapping.fallbackIdentifierField,
		);

		if (value === undefined) {
			args.onDiagnostic?.({
				reason: "missing-param",
				collection: args.collection,
				param: name,
			});

			return null;
		}

		params[name] = value;
	}

	const identifying = resolvers.paramNames.at(-1);

	/*
	 * A wildcard collection stores the site root as "/", which `compile`
	 * cannot express — it needs at least one segment. The root still goes
	 * through `formatHref`, so it is not the one path that misses the locale
	 * and preview prefixes every other path receives.
	 */
	if (identifying && params[identifying] === "/") {
		return format({ path: "/", locale: args.locale });
	}

	return format({ path: resolvers.build(params), locale: args.locale });
};
