import type { DummyRef } from "./types.js";
import type { CollectionSlug } from "payload";

/*
 * A string brand rather than a symbol, so a ref survives `structuredClone` and
 * a JSON fixture. Nothing reaches Payload carrying it: the writer substitutes
 * every ref before it hands data over.
 */
const BRAND = "__dummyRef";

/**
 * Names a document by its natural key. Resolves to the document's id, which is
 * the shape of a single or `hasMany` relationship and of an upload field.
 *
 * @param collection The collection holding the document.
 * @param key The document's natural key value.
 */
export const dummyRef = (
	collection: CollectionSlug,
	key: string,
): DummyRef => ({
	[BRAND]: "id",
	collection,
	key,
});

/**
 * Names a document for a polymorphic relationship or a rich text link node,
 * which both take `{ relationTo, value }` rather than a bare id.
 *
 * @param collection The collection holding the document.
 * @param key The document's natural key value.
 */
export const dummyPolyRef = (
	collection: CollectionSlug,
	key: string,
): DummyRef => ({ [BRAND]: "polymorphic", collection, key });

/** Whether a value is a ref token. */
export const isDummyRef = (value: unknown): value is DummyRef => {
	if (typeof value !== "object" || value === null) {
		return false;
	}

	const kind = (value as Record<string, unknown>)[BRAND];

	return kind === "id" || kind === "polymorphic";
};

/** How a ref reads in an error message. */
export const describeRef = (ref: DummyRef): string =>
	`${ref.collection}:"${ref.key}"`;
