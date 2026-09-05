import { buildHref } from "./build-href.js";
import { buildPath } from "./build-path.js";
import { isAvailableLink, resolveLink } from "./resolve-link.js";
import { resolvePathToDocument } from "./resolve-path.js";
import { normaliseLinkNodeFields } from "../pattern/link-node.js";

import type { LinkableDocument } from "./build-href.js";
import type { DiagnosticReason, OnDiagnostic } from "./diagnostics.js";
import type { ResolveLinkArgs, ResolveReference } from "./resolve-link.js";
import type {
	PayloadDocument,
	ResolvePathWhere,
	ResolvedPath,
} from "./resolve-path.js";
import type {
	LinkContextOf,
	LinkDataOf,
	LinkDeclaration,
	ResolvedLinkOf,
} from "../pattern/define-links.js";
import type {
	FormatHref,
	PayloadCollectionMappingResolved,
} from "../pattern/types.js";
import type { Payload } from "payload";

export interface CreateRouterArgs<
	TDeclaration extends LinkDeclaration = LinkDeclaration,
> {
	mappings: PayloadCollectionMappingResolved[];
	/** Which locale's pattern every call builds and matches against. */
	locale: string;
	/**
	 * Rewrites every path this router produces.
	 *
	 * Bound here rather than passed per call because it has to reach three
	 * functions to be correct, and the one that is easy to forget —
	 * `resolveLink`, which builds hrefs internally — is the one whose omission
	 * sends a visitor out of the locale or out of preview on the first click.
	 */
	formatHref?: FormatHref;
	/** The link vocabulary, as built by `defineLinks`. */
	links?: TDeclaration;
	/** Handed to a variant's own resolver untouched. */
	context?: LinkContextOf<TDeclaration>;
	resolveReference?: ResolveReference;
	onDiagnostic?: OnDiagnostic<DiagnosticReason>;
}

/** Everything a request needs in order to turn documents and links into URLs. */
export interface Router<
	TDeclaration extends LinkDeclaration = LinkDeclaration,
> {
	/** The href a document is served at, or null. */
	href: (collection: string, document: LinkableDocument) => string | null;
	/**
	 * A path built from parameter values alone, for a sitemap or a feed that
	 * holds the values but no document. Positional values are in pattern
	 * order. Never null: an unmapped collection falls back to the site root,
	 * because a bare root in a feed is recoverable and an empty href is not.
	 */
	path: (
		collection: string,
		values: string[] | Record<string, string>,
	) => string;
	/** An authored link's href, or null when it points nowhere navigable. */
	link: (
		link: LinkDataOf<TDeclaration> | undefined,
	) => ResolvedLinkOf<TDeclaration> | null;
	/** The same, for a rich-text link node's `fields`. */
	linkNode: (fields: unknown) => ResolvedLinkOf<TDeclaration> | null;
	/** Whether a link would resolve, so a dead anchor is never rendered. */
	isAvailable: (
		link: LinkDataOf<TDeclaration> | undefined,
		opts?: { withLabel?: boolean },
	) => boolean;
	/** The document a request path resolves to, or null. */
	resolve: <
		TDocs extends Record<string, object> = Record<string, PayloadDocument>,
	>(
		path: string,
		opts: {
			payload: Payload;
			draft?: boolean;
			depth?: number;
			where?: ResolvePathWhere;
		},
	) => Promise<ResolvedPath<TDocs> | null>;
}

/**
 * Binds the mappings, the locale and the href formatter once per request.
 *
 * Everything below takes the same three values, and threading them by hand
 * meant every call site could get one wrong. The values that vary per request
 * are bound here; the one that does not — which field a relationship parameter
 * matches on — rides the compiled mappings instead.
 *
 * The functions this closes over are exported from `./internal` for a caller
 * that would rather pass everything explicitly, and are what the package's own
 * tests use.
 *
 * @param args The mappings, locale and per-request link settings.
 */
export const createRouter = <
	TDeclaration extends LinkDeclaration = LinkDeclaration,
>(
	args: CreateRouterArgs<TDeclaration>,
): Router<TDeclaration> => {
	const shared: Omit<ResolveLinkArgs<TDeclaration>, "link"> = {
		mappings: args.mappings,
		locale: args.locale,
		...(args.formatHref ? { formatHref: args.formatHref } : {}),
		...(args.links ? { links: args.links } : {}),
		...(args.context !== undefined ? { context: args.context } : {}),
		...(args.resolveReference
			? { resolveReference: args.resolveReference }
			: {}),
		...(args.onDiagnostic ? { onDiagnostic: args.onDiagnostic } : {}),
	};

	return {
		href: (collection, document) =>
			buildHref({ ...shared, collection, document }),

		path: (collection, values) => buildPath({ ...shared, collection, values }),

		link: (link) => resolveLink({ ...shared, link }),

		linkNode: (fields) =>
			resolveLink({
				...shared,
				link: normaliseLinkNodeFields(
					fields,
				) as ResolveLinkArgs<TDeclaration>["link"],
			}),

		isAvailable: (link, opts) => isAvailableLink({ ...shared, link, ...opts }),

		/*
		 * Built from the arguments rather than from `shared`, which is typed
		 * for link resolution and so narrows `onDiagnostic` to the reasons a
		 * link can report. A path lookup reports its own.
		 */
		resolve: (path, opts) =>
			resolvePathToDocument({
				mappings: args.mappings,
				locale: args.locale,
				path,
				...opts,
				...(args.onDiagnostic ? { onDiagnostic: args.onDiagnostic } : {}),
			}),
	};
};
