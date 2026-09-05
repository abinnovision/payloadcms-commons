import { buildHref } from "./build-href.js";
import { variantsOf } from "../pattern/define-links.js";

import type {
	OnDiagnostic,
	ResolveLinkDiagnosticReason,
} from "./diagnostics.js";
import type {
	LinkContextOf,
	LinkDataOf,
	LinkDeclaration,
	LinkVariantSource,
	ResolvedLinkOf,
} from "../pattern/define-links.js";
import type {
	BaseResolvedLink,
	DocumentId,
	FormatHref,
	PayloadCollectionMappingResolved,
} from "../pattern/types.js";

/** Types the package resolves without a declaration. */
const BUILTIN_VARIANTS = new Set<string>([
	"none",
	"reference",
	"custom",
	"same-page",
]);

const newTabProps = (newTab: boolean | null | undefined) =>
	newTab ? { target: "_blank", rel: "noopener noreferrer" } : {};

/**
 * Turns a reference into an href by some means other than the populated
 * document — an id-to-identifier index, typically.
 *
 * Supplied only by projects that cap relationship depth, where a reference
 * arrives as a bare id. One injected function rather than a second built-in
 * strategy: the package resolves from the populated document, and this is the
 * documented way out for setups that cannot.
 */
export type ResolveReference = (args: {
	relationTo: string;
	value: DocumentId | { id: DocumentId };
	locale: string;
}) => string | null;

export interface ResolveLinkArgs<
	TDeclaration extends LinkDeclaration = LinkDeclaration,
> extends LinkVariantSource<TDeclaration> {
	/**
	 * The link group's value.
	 *
	 * Typed off the declaration rather than a second type parameter, so a
	 * variant's own fields are accepted here without the caller naming them.
	 * With no declaration this widens to the built-in shape.
	 */
	link: LinkDataOf<TDeclaration> | undefined;
	mappings: PayloadCollectionMappingResolved[];
	locale: string;
	/**
	 * Passed through to a variant's resolver untouched.
	 *
	 * When a declaration is supplied its resolvers already say what they
	 * expect, so that shape wins over the array form's own parameter: without
	 * this, any context at all would satisfy a declaration-based call.
	 */
	context?: LinkContextOf<TDeclaration>;
	formatHref?: FormatHref;
	resolveReference?: ResolveReference;
	onDiagnostic?: OnDiagnostic<ResolveLinkDiagnosticReason>;
}

/**
 * Turns a link field's value into an href.
 *
 * Internal references route through the collection mapping rather than any
 * hardcoded prefix, so changing a collection's URL pattern in the CMS updates
 * every link to it.
 *
 * Returns null rather than degrading to the site root. A link that silently
 * points somewhere plausible is harder to find than one that renders nothing.
 *
 * @param args The link value, mappings, locale and any app-declared variants.
 */
export const resolveLink = <
	TDeclaration extends LinkDeclaration = LinkDeclaration,
>(
	args: ResolveLinkArgs<TDeclaration>,
): ResolvedLinkOf<TDeclaration> | null => {
	/*
	 * The built-in branches below each build a `{ href, target?, rel? }`,
	 * which is `ResolvedLinkOf` with none of its contributed properties set.
	 * TypeScript cannot see that while the type parameter is uninstantiated,
	 * so they are asserted through this one alias rather than at four call
	 * sites. Returning the union instead would push the same assertion onto
	 * every consumer reading a variant's own property, which is the whole
	 * point of carrying the declaration.
	 */
	type Resolved = ResolvedLinkOf<TDeclaration>;
	const builtin = (it: BaseResolvedLink): Resolved => it as Resolved;

	const link = args.link;

	if (!link?.type || link.type === "none") {
		return null;
	}

	/*
	 * The registry is consulted before the built-ins, so declaring a variant
	 * with a built-in's value replaces it rather than being shadowed by it.
	 * The built-ins are defaults: an in-page link that has to offset for a
	 * fixed header, or an internal link that routes through something other
	 * than the mapping, is still the same link type to an editor and should
	 * not need a second one invented for it.
	 */
	const declared = variantsOf<LinkContextOf<TDeclaration>, object>(args);
	const variant = declared.find((it) => it.value === link.type);

	if (variant?.resolve) {
		return variant.resolve({
			link,
			context: args.context as LinkContextOf<TDeclaration>,
		}) as Resolved | null;
	}

	if (link.type === "custom" && link.url) {
		return builtin({ href: link.url, ...newTabProps(link.newTab) });
	}

	if (link.type === "same-page" && link.samePageIdentifier) {
		return builtin({ href: `#${link.samePageIdentifier}` });
	}

	if (link.type === "reference" && link.reference) {
		const { relationTo, value } = link.reference;

		if (args.resolveReference) {
			const href = args.resolveReference({
				relationTo,
				value,
				locale: args.locale,
			});

			return href ? builtin({ href, ...newTabProps(link.newTab) }) : null;
		}

		/*
		 * An unpopulated relationship is just an id, which cannot be routed.
		 * Tested by what it is not, because the id's type follows the database
		 * adapter — a string on Mongo, a number on SQLite and serial Postgres.
		 * Checking for `string` alone let a numeric id fall through to
		 * `buildHref`, which then reported a missing path parameter instead of
		 * the unpopulated reference actually behind it.
		 */
		if (!value || typeof value !== "object") {
			args.onDiagnostic?.({
				reason: "unpopulated-reference",
				collection: relationTo,
			});

			return null;
		}

		const href = buildHref({
			mappings: args.mappings,
			collection: relationTo,
			document: value,
			locale: args.locale,
			...(args.formatHref ? { formatHref: args.formatHref } : {}),
			...(args.onDiagnostic ? { onDiagnostic: args.onDiagnostic } : {}),
		});

		return href ? builtin({ href, ...newTabProps(link.newTab) }) : null;
	}

	/*
	 * A type that is neither built in nor declared. The usual cause is a
	 * variant added to the field but not passed to the resolver, which would
	 * otherwise just make the link disappear.
	 */
	if (!BUILTIN_VARIANTS.has(link.type) && !variant) {
		args.onDiagnostic?.({ reason: "unknown-variant", variant: link.type });
	}

	return null;
};

/**
 * Whether a link would resolve to something navigable. Use it to decide
 * whether to render a link at all, rather than emitting a dead anchor.
 *
 * @param args The same arguments as {@link resolveLink}, plus whether a label
 *   is required for the link to be worth rendering.
 */
export const isAvailableLink = <
	TDeclaration extends LinkDeclaration = LinkDeclaration,
>(
	args: ResolveLinkArgs<TDeclaration> & { withLabel?: boolean },
): boolean => {
	if (args.withLabel && !args.link?.label) {
		return false;
	}

	return resolveLink(args) !== null;
};
