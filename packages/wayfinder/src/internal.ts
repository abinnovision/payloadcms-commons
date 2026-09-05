/**
 * The unbound functions the router is built out of, plus the pattern
 * internals.
 *
 * Nothing here carries a compatibility guarantee. It exists because the
 * package's own tests call these directly, and because a caller with an
 * unusual shape — one that holds no request, or wants a different set of
 * arguments per call — should not have to fork the package to reach them. Use
 * `createRouter` unless you know why you are not.
 */

export { buildHref, identityFormatHref } from "./runtime/build-href.js";
export { buildPath } from "./runtime/build-path.js";
export { isAvailableLink, resolveLink } from "./runtime/resolve-link.js";
export { resolvePathToDocument } from "./runtime/resolve-path.js";
export { variantsOf } from "./pattern/define-links.js";
export { normaliseLinkNodeFields } from "./pattern/link-node.js";
export { matchCollectionMappings } from "./pattern/matcher.js";
export { resolveParamQueryPath } from "./pattern/param-query-path.js";
export {
	isRootWildcard,
	resolveCollectionMapping,
	resolversFor,
} from "./pattern/resolver.js";
export {
	DEFAULT_IDENTIFIER_FIELD,
	DEFAULT_LOCALE_KEY,
} from "./pattern/types.js";

export type { BuildHrefArgs } from "./runtime/build-href.js";
export type { BuildPathArgs } from "./runtime/build-path.js";
export type { ResolveLinkArgs } from "./runtime/resolve-link.js";
export type { ResolvePathToDocumentArgs } from "./runtime/resolve-path.js";
export type {
	AnyLinkVariantDefinition,
	DataOfFields,
	LinkVariantDefinition,
	LinkVariantSource,
	LinkVariantSpec,
	VariantBuilder,
} from "./pattern/define-links.js";
export type {
	RegisteredCollections,
	ResolveParamQueryPathArgs,
} from "./pattern/param-query-path.js";
export type {
	Contributed,
	DeclaredLinkVariant,
	ResolvedLink,
	PayloadCollectionMappingMatch,
	PayloadCollectionMappingResolvers,
	PayloadCollectionMappingSpecificity,
} from "./pattern/types.js";
