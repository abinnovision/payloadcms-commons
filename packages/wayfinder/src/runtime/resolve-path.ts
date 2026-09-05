import { matchCollectionMappings } from "../pattern/matcher.js";
import { resolveParamQueryPath } from "../pattern/param-query-path.js";

import type {
	OnDiagnostic,
	ResolvePathDiagnosticReason,
} from "./diagnostics.js";
import type { PayloadCollectionMatch } from "../pattern/matcher.js";
import type { PayloadCollectionMappingResolved } from "../pattern/types.js";
import type { Payload, Where } from "payload";

/**
 * Blocks nest arbitrarily deep and read their relationships directly, so the
 * default is generous. Lower it when a project knows its own shape.
 */
const DEFAULT_DOCUMENT_DEPTH = 10;

/**
 * A fetched document. The concrete shape varies per collection and callers
 * read it structurally, so it is an open record rather than the union of every
 * generated collection type.
 */
export type PayloadDocument = { id: string | number } & Record<string, unknown>;

/**
 * What a path resolved to: which collection claimed it, the document behind
 * it, and the identifier and scope the pattern produced.
 *
 * Parameterised by a map of collection slug to document type, which is exactly
 * the shape Payload generates as `Config["collections"]`. Supplying it turns
 * the result into a discriminated union, so narrowing on `collection` types
 * `document` and a consumer stops reading an open record defensively. The
 * default reproduces the untyped shape, so this costs an existing caller
 * nothing.
 *
 * The union is unsound by construction, and knowingly so: which collection
 * wins is decided at request time by an editor-authored mapping, not by
 * anything the compiler can see. It states what the mapping can produce, not
 * what it will.
 */
export type ResolvedPath<
	TDocs extends Record<string, object> = Record<string, PayloadDocument>,
> = {
	[K in keyof TDocs & string]: {
		match: PayloadCollectionMatch;
		collection: K;
		document: TDocs[K];
	};
}[keyof TDocs & string];

/** Extra conditions to AND into the lookup. */
export type ResolvePathWhere =
	| Where
	| ((args: {
			collection: string;
			match: PayloadCollectionMatch;
			draft: boolean;
	  }) => Where | undefined);

export interface ResolvePathToDocumentArgs {
	payload: Payload;
	mappings: PayloadCollectionMappingResolved[];
	path: string;
	locale: string;
	/** Read drafts rather than only published documents. */
	draft?: boolean;
	depth?: number;
	/**
	 * Access rules, tenancy and language visibility all narrow which document
	 * a path may resolve to, and none of them belong to the package. Without
	 * this seam a project has to query twice or fork the function.
	 */
	where?: ResolvePathWhere;
	onDiagnostic?: OnDiagnostic<ResolvePathDiagnosticReason>;
}

/**
 * Turns the matched scope parameters into query conditions.
 *
 * Reuses the same parameter resolution the mapping validator applies at save
 * time, so a pattern that validated will query the field it promised.
 */
const buildScopeConditions = (args: {
	payload: Payload;
	collection: string;
	scope: Record<string, string>;
	mappings: PayloadCollectionMappingResolved[];
	locale: string;
}): Where[] => {
	const config = args.payload.collections[args.collection]?.config;

	if (!config) {
		return [];
	}

	return Object.entries(args.scope).flatMap(([param, value]) => {
		const resolved = resolveParamQueryPath({
			config,
			param,
			collections: args.payload.collections,
			mappings: args.mappings,
			locale: args.locale,
		});

		return "error" in resolved
			? []
			: [{ [resolved.queryPath]: { equals: value } } satisfies Where];
	});
};

/**
 * Whether a collection keeps drafts.
 *
 * Payload only adds `_status` to a collection that does, so both asking for a
 * draft read and filtering on published status have to be conditional: on a
 * collection without versions the column does not exist and the query fails
 * outright rather than coming back empty.
 */
const supportsDrafts = (payload: Payload, collection: string): boolean =>
	Boolean(payload.collections[collection]?.config.versions?.drafts);

/**
 * Restricts a public read to published documents.
 *
 * `payload.find` with `draft: false` still returns the newest version of a
 * document, which for a drafts-enabled collection includes one that has never
 * been published. Without this a URL becomes routable the moment someone saves
 * a draft at it, which is the opposite of what turning drafts on is for.
 */
const publishedOnly = (
	payload: Payload,
	collection: string,
	draft: boolean,
): Where[] =>
	!draft && supportsDrafts(payload, collection)
		? [{ _status: { equals: "published" } }]
		: [];

/**
 * Finds the document a path resolves to, or null.
 *
 * Candidates are tried in specificity order and the first one that actually
 * has a document wins. Without the fallback a nested page path would be
 * claimed by a more specific pattern and 404 even though the page exists —
 * `/legal/imprint` also fits `/:section/:slug`.
 *
 * @param args The Payload instance, mappings, path and locale.
 */
export const resolvePathToDocument = async <
	TDocs extends Record<string, object> = Record<string, PayloadDocument>,
>(
	args: ResolvePathToDocumentArgs,
): Promise<ResolvedPath<TDocs> | null> => {
	const draft = args.draft ?? false;

	const matches = matchCollectionMappings({
		path: args.path,
		locale: args.locale,
		mappings: args.mappings,
	});

	if (matches.length === 0) {
		args.onDiagnostic?.({ reason: "no-mapping", path: args.path });

		return null;
	}

	for (const match of matches) {
		const collection = match.mapping.collection;
		const extra =
			typeof args.where === "function"
				? args.where({ collection, match, draft })
				: args.where;

		const response = await args.payload.find({
			collection: collection,
			locale: args.locale,
			draft: draft && supportsDrafts(args.payload, collection),
			// Access control gates reads behind auth; public rendering is allowed.
			overrideAccess: true,
			limit: 1,
			depth: args.depth ?? DEFAULT_DOCUMENT_DEPTH,
			where: {
				and: [
					{ [match.identifier.field]: { equals: match.identifier.value } },
					...buildScopeConditions({
						payload: args.payload,
						collection,
						scope: match.scope,
						mappings: args.mappings,
						locale: args.locale,
					}),
					...publishedOnly(args.payload, collection, draft),
					...(extra ? [extra] : []),
				],
			},
		});

		const document = response.docs[0] as unknown as PayloadDocument | undefined;

		if (document) {
			/*
			 * Which collection won is decided here, by the mapping, so the
			 * narrowed member of the union cannot be known statically.
			 */
			const resolved = { match, collection, document };

			return resolved as unknown as ResolvedPath<TDocs>;
		}
	}

	args.onDiagnostic?.({ reason: "no-document", path: args.path });

	return null;
};
