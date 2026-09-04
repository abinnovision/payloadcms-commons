export { defineMappings } from "./define-mappings.js";
export { matchCollectionMappings } from "./matcher.js";
export {
	DEFAULT_IDENTIFIER_FIELD,
	resolveParamQueryPath,
} from "./param-query-path.js";
export {
	isRootWildcard,
	resolveCollectionMapping,
	resolversFor,
} from "./resolver.js";
export { DEFAULT_LOCALE_KEY } from "./types.js";

export type { PayloadCollectionMatch } from "./matcher.js";
export type {
	RegisteredCollections,
	ResolveParamQueryPathArgs,
} from "./param-query-path.js";
export type {
	BaseResolvedLink,
	BuiltinLinkVariant,
	FormatHref,
	LabelLike,
	LinkFieldData,
	LinkVariant,
	PayloadCollectionMapping,
	PayloadCollectionMappingMatch,
	PayloadCollectionMappingResolved,
	PayloadCollectionMappingResolvers,
	PayloadCollectionMappingSpecificity,
	ResolvedLink,
} from "./types.js";
