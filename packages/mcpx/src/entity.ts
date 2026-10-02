import type { SanitizedCollectionConfig, SanitizedGlobalConfig } from "payload";

/**
 * Names a collection or a global before its config is looked up. Everything in
 * the schema layer is written against this rather than a bare slug, because a
 * slug alone cannot say which of the two namespaces it belongs to.
 */
export interface EntityRef {
	kind: "collection" | "global";
	slug: string;
}

/**
 * Discriminated so a caller that must hand Payload a real config can narrow,
 * while one that only needs `flattenedFields` can ignore the discriminant.
 */
export type ResolvedEntity =
	| { kind: "collection"; slug: string; config: SanitizedCollectionConfig }
	| { kind: "global"; slug: string; config: SanitizedGlobalConfig };

/*
 * The id type follows the database adapter and a collection's own `id` field,
 * so one project can have both. Payload's `DefaultDocumentIDType` narrows to
 * the project default and so cannot be used here.
 */
export type DocumentId = number | string;

export type DocumentRef =
	| (Extract<ResolvedEntity, { kind: "collection" }> & { id: DocumentId })
	| Extract<ResolvedEntity, { kind: "global" }>;
