/**
 * The runtime half: everything that turns mappings into URLs and back.
 *
 * Takes mappings as plain data and never reads the CMS, so it runs in a route
 * handler, a sitemap, a script or a test alike. `createRouter` is the way in;
 * the unbound functions behind it are exported from `./internal` for the rare
 * caller that wants them, without standing on the front door.
 */

export { createRouter } from "./runtime/create-router.js";
export { resolveRelationshipSlug } from "./runtime/resolve-relationship-slug.js";
export { defineLinks } from "./pattern/define-links.js";
export { defineMappings } from "./pattern/define-mappings.js";
export { deriveLinkLabel } from "./pattern/derive-link-label.js";

export type { CreateRouterArgs, Router } from "./runtime/create-router.js";
export type { LinkableDocument } from "./runtime/build-href.js";
export type { ResolveReference } from "./runtime/resolve-link.js";
export type {
	PayloadDocument,
	ResolvePathWhere,
	ResolvedPath,
} from "./runtime/resolve-path.js";
export type {
	BuildDiagnosticReason,
	Diagnostic,
	DiagnosticReason,
	OnDiagnostic,
	ResolveLinkDiagnosticReason,
	ResolvePathDiagnosticReason,
} from "./runtime/diagnostics.js";
export type {
	LinkContextOf,
	LinkDataOf,
	LinkDeclaration,
	ResolvedLinkOf,
} from "./pattern/define-links.js";
export type { PayloadCollectionMatch } from "./pattern/matcher.js";
export type {
	BaseResolvedLink,
	BuiltinLinkVariant,
	DocumentId,
	FormatHref,
	LabelLike,
	LinkFieldData,
	PayloadCollectionMapping,
	PayloadCollectionMappingResolved,
	ResolvedLink,
} from "./pattern/types.js";
