import type { ParamData } from "path-to-regexp";
import type { Field } from "payload";

/**
 * Locale bucket used when a project has no localization configured.
 *
 * Payload only returns a per-locale record for a localized field, and only
 * when the config declares locales at all. Without them the mapping's `path`
 * arrives as a plain string, which normalises into this single bucket so the
 * rest of the package has one shape to work with.
 */
export const DEFAULT_LOCALE_KEY = "__default";

/**
 * Maps one collection onto the URL patterns its documents live at.
 *
 * A localized project supplies one pattern per locale; a project without
 * localization supplies a single pattern. Authored in the mapping global, so
 * adding a page type never means touching routing code.
 */
export interface PayloadCollectionMapping {
	collection: string;
	/**
	 * Either one pattern per locale (`{ de: "/:format/:slug" }`) or a single
	 * pattern for a project with no locales.
	 */
	path: string | Record<string, string>;
}

/**
 * Result of matching a path against one mapping.
 */
export interface PayloadCollectionMappingMatch {
	/**
	 * The pattern's last parameter, which identifies the document within its
	 * collection.
	 */
	identifier: { field: string; value: string };
	/**
	 * Any earlier parameters, keyed by their raw parameter name. These narrow
	 * the lookup without identifying the document — `format` in
	 * `/:format/:slug` is one.
	 */
	scope: Record<string, string>;
}

/**
 * How specific a pattern is, used to order candidates so that the most
 * precise pattern wins regardless of the order rows sit in the admin UI.
 */
export interface PayloadCollectionMappingSpecificity {
	/** Segments that are literal text rather than a parameter. */
	literalSegments: number;
	/** Whether the pattern ends in a catch-all. */
	hasWildcard: boolean;
	totalSegments: number;
}

export interface PayloadCollectionMappingResolvers {
	match: (path: string) => false | PayloadCollectionMappingMatch;
	build: (params: ParamData) => string;
	/**
	 * Parameter names in pattern order, so callers can collect the values a
	 * `build` needs without re-parsing the pattern. The last entry identifies
	 * the document.
	 */
	paramNames: string[];
	specificity: PayloadCollectionMappingSpecificity;
}

export interface PayloadCollectionMappingResolved {
	collection: string;
	/** Always a record after normalisation, keyed by locale or by {@link DEFAULT_LOCALE_KEY}. */
	path: Record<string, string>;
	resolvers: Record<string, PayloadCollectionMappingResolvers>;
}

/**
 * Rewrites a built path before it is returned.
 *
 * Locale prefixing and preview prefixing are the same transform applied at the
 * same point, so they share one hook rather than competing for two options:
 *
 * ```ts
 * formatHref: ({ path, locale }) => `/${locale}${path}`
 * formatHref: ({ path, locale }) => `/${locale}${isPreview ? "/-preview" : ""}${path}`
 * ```
 *
 * Defaults to returning the path untouched, so a project serving unprefixed
 * URLs needs no configuration.
 */
export type FormatHref = (args: { path: string; locale: string }) => string;

/** Label accepted wherever the admin panel shows one. */
export type LabelLike = string | Record<string, string>;

/**
 * Optional-everything, including an explicit `undefined`.
 *
 * `Partial<T>` is not enough under `exactOptionalPropertyTypes`: it marks a
 * property optional without letting it hold `undefined`, so a variant that
 * reads one of its own optional fields and passes it straight back would not
 * typecheck against its own declared shape.
 */
export type Contributed<T> = { [K in keyof T]?: T[K] | undefined };

/** The link types the package understands without configuration. */
export type BuiltinLinkVariant = "none" | "reference" | "custom" | "same-page";

/**
 * How Payload identifies a document.
 *
 * Mongo keys by string, SQLite and serial Postgres by number. Every place a
 * reference id crosses the package boundary accepts both, so a project is not
 * forced to cast at the call site over its own choice of adapter.
 */
export type DocumentId = string | number;

/**
 * Structural shape of the `link` field group.
 *
 * Declared here rather than imported from a project's generated types so the
 * field definition that produces it does not depend on its own output.
 * Nullable throughout because that is how Payload emits optional fields — a
 * mismatch here shows up at every call site.
 *
 * `TVariant` carries any app-declared variant names, and `TExtra` the fields
 * those variants contribute, so a variant's own resolver can read the data its
 * own fields produced without a cast.
 */
export type LinkFieldData<TVariant extends string = never, TExtra = object> = {
	type?: BuiltinLinkVariant | TVariant | null;
	label?: string | null;
	/*
	 * No index signature at either level. Payload generates the per-collection
	 * types as interfaces, and an interface gets no implicit index signature,
	 * so requiring one here would make every populated reference fail to
	 * assign.
	 *
	 * The id is `string | number` because that is what Payload's adapters
	 * emit: Mongo keys documents by string, SQLite and serial Postgres by
	 * number. Narrowing to `string` would be wrong for half of them, and a
	 * wrong type gets believed.
	 */
	reference?: {
		relationTo: string;
		value: DocumentId | { id: DocumentId };
	} | null;
	url?: string | null;
	samePageIdentifier?: string | null;
	newTab?: boolean | null;
} & Contributed<TExtra>;

/** What every link resolves to, before any variant adds to it. */
export interface BaseResolvedLink {
	href: string;
	target?: string;
	rel?: string;
}

/**
 * A resolved link, widened by whatever an app-declared variant returns.
 *
 * `E` defaults to an empty object rather than `unknown`: an intersection with
 * an uninstantiated type parameter stays deferred, which would force a cast at
 * every built-in branch.
 *
 * Every contributed property is optional, for the same reason it is on
 * {@link LinkFieldData}: `E` is the union of what *every* variant contributes,
 * so requiring all of it would mean each variant had to return the other
 * variants' properties alongside its own.
 */
export type ResolvedLink<E = object> = BaseResolvedLink & Contributed<E>;

/**
 * One variant, flattened out of a declaration with its key put back on it.
 *
 * The shape everything downstream of {@link defineLinks} works with. Not an
 * authoring form: variants are written through the builder, which is what
 * derives their field types.
 */
export interface DeclaredLinkVariant<TCtx = unknown, TExtra = object> {
	value: string;
	label: LabelLike;
	/** Readonly, because a `const` type parameter infers a readonly tuple. */
	fields?: readonly Field[];
	resolve?: (args: {
		link: LinkFieldData<string, TExtra>;
		context: TCtx;
	}) => ResolvedLink<TExtra> | null;
}
