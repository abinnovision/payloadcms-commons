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

/** The link types the package understands without configuration. */
export type BuiltinLinkVariant = "none" | "reference" | "custom" | "same-page";

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
	 * No index signature: the generated per-collection interfaces do not have
	 * one, and adding it here would make every populated reference fail to
	 * assign.
	 */
	reference?: {
		relationTo: string;
		value: string | { id: string; [field: string]: unknown };
	} | null;
	url?: string | null;
	samePageIdentifier?: string | null;
	newTab?: boolean | null;
} & Partial<TExtra>;

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
 */
export type ResolvedLink<E = object> = BaseResolvedLink & E;

/**
 * An app-declared link type.
 *
 * `fields` are shown in the admin panel under a condition on the variant's own
 * value, and `resolve` turns the resulting data into a link. The resolver sits
 * on the variant rather than in a separate map so there is exactly one place a
 * link type is defined.
 */
export interface LinkVariant<TCtx = unknown, TExtra = object> {
	value: string;
	label: LabelLike;
	fields?: Field[];
	resolve?: (args: {
		link: LinkFieldData<string, TExtra>;
		context: TCtx;
	}) => ResolvedLink<TExtra> | null;
}
