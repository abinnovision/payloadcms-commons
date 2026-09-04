import { buildHref } from "./build-href.js";
import { variantsOf } from "../pattern/define-links.js";

import type {
	OnDiagnostic,
	ResolveLinkDiagnosticReason,
} from "./diagnostics.js";
import type {
	LinkContextOf,
	LinkDeclaration,
	LinkVariantSource,
	ResolvedLinkOf,
} from "../pattern/define-links.js";
import type {
	BaseResolvedLink,
	FormatHref,
	LinkFieldData,
	PayloadCollectionMappingResolved,
	ResolvedLink,
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
	value: string | { id: string };
	locale: string;
}) => string | null;

export interface ResolveLinkArgs<
	TCtx = unknown,
	TExtra = object,
	TDeclaration extends LinkDeclaration = LinkDeclaration,
> extends LinkVariantSource<TCtx, TExtra, TDeclaration> {
	link: LinkFieldData<string, TExtra> | undefined;
	mappings: PayloadCollectionMappingResolved[];
	locale: string;
	/** Passed through to a variant's resolver untouched. */
	/**
	 * Passed through to a variant's resolver untouched.
	 *
	 * When a declaration is supplied its resolvers already say what they
	 * expect, so that shape wins over the array form's own parameter: without
	 * this, any context at all would satisfy a declaration-based call.
	 */
	context?: unknown extends LinkContextOf<TDeclaration>
		? TCtx
		: LinkContextOf<TDeclaration>;
	formatHref?: FormatHref;
	identifierField?: string;
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
	TCtx = unknown,
	TExtra = object,
	TDeclaration extends LinkDeclaration = LinkDeclaration,
>(
	args: ResolveLinkArgs<TCtx, TExtra, TDeclaration>,
):
	| BaseResolvedLink
	| ResolvedLink<TExtra>
	| ResolvedLinkOf<TDeclaration>
	| null => {
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
	const declared = variantsOf<TCtx, TExtra>(args);
	const variant = declared.find((it) => it.value === link.type);

	if (variant?.resolve) {
		return variant.resolve({ link, context: args.context as TCtx });
	}

	if (link.type === "custom" && link.url) {
		return { href: link.url, ...newTabProps(link.newTab) };
	}

	if (link.type === "same-page" && link.samePageIdentifier) {
		return { href: `#${link.samePageIdentifier}` };
	}

	if (link.type === "reference" && link.reference) {
		const { relationTo, value } = link.reference;

		if (args.resolveReference) {
			const href = args.resolveReference({
				relationTo,
				value,
				locale: args.locale,
			});

			return href ? { href, ...newTabProps(link.newTab) } : null;
		}

		// An unpopulated relationship is just an id, which cannot be routed.
		if (typeof value === "string") {
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
			...(args.identifierField
				? { identifierField: args.identifierField }
				: {}),
			...(args.onDiagnostic ? { onDiagnostic: args.onDiagnostic } : {}),
		});

		return href ? { href, ...newTabProps(link.newTab) } : null;
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
	TCtx = unknown,
	TExtra = object,
	TDeclaration extends LinkDeclaration = LinkDeclaration,
>(
	args: ResolveLinkArgs<TCtx, TExtra, TDeclaration> & { withLabel?: boolean },
): boolean => {
	if (args.withLabel && !args.link?.label) {
		return false;
	}

	return resolveLink(args) !== null;
};
