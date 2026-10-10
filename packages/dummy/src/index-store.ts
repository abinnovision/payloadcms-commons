import { describeRef } from "./ref.js";

import type { DummyDocumentId, DummyRef } from "./types.js";
import type { CollectionSlug, Payload } from "payload";

/** Resolves a natural key to a document id, from the run or the database. */
export interface DummyIndexStore {
	/** Remembers that a write landed, so a later ref resolves without a query. */
	record: (
		collection: CollectionSlug,
		key: string,
		id: DummyDocumentId,
	) => void;
	/** Looks up the keys a walk is about to need. */
	warm: (refs: readonly DummyRef[]) => Promise<void>;
	/** The id for a ref, if known. Synchronous, so a walk can stay structural. */
	get: (ref: DummyRef) => DummyDocumentId | undefined;
	/** What this run wrote to a collection, for an unresolved-ref message. */
	keysIn: (collection: CollectionSlug) => readonly string[];
	/** Whether this run wrote anything to a collection at all. */
	touched: (collection: CollectionSlug) => boolean;
}

const cacheKey = (collection: string, key: string): string =>
	`${collection}:${key}`;

/**
 * Creates the natural-key index for one run.
 *
 * `warm` falls back to the database so a run with `--only`, or a re-run without
 * `--fresh`, resolves against what an earlier run wrote. Only positive lookups
 * are cached: a key missing now may be written by a later seed.
 *
 * @param payload The initialised Payload instance.
 * @param keyFor Answers a collection's natural key field.
 */
export const createIndexStore = (
	payload: Payload,
	keyFor: (collection: CollectionSlug) => string,
): DummyIndexStore => {
	const ids = new Map<string, DummyDocumentId>();
	const written = new Map<string, Set<string>>();

	const record: DummyIndexStore["record"] = (collection, key, id) => {
		ids.set(cacheKey(collection, key), id);

		const keys = written.get(collection) ?? new Set<string>();

		keys.add(key);
		written.set(collection, keys);
	};

	const get: DummyIndexStore["get"] = (ref) =>
		ids.get(cacheKey(ref.collection, ref.key));

	const warm: DummyIndexStore["warm"] = async (refs) => {
		const missing = new Map<string, DummyRef>();

		for (const ref of refs) {
			const slot = cacheKey(ref.collection, ref.key);

			if (!ids.has(slot)) {
				missing.set(slot, ref);
			}
		}

		for (const ref of missing.values()) {
			// eslint-disable-next-line no-await-in-loop -- one lookup per unknown key, and the set is small
			const found = await payload.find({
				collection: ref.collection,
				where: { [keyFor(ref.collection)]: { equals: ref.key } },
				limit: 1,
				depth: 0,
				pagination: false,
				overrideAccess: true,
			});
			const id = found.docs.at(0)?.id;

			if (id !== undefined) {
				ids.set(cacheKey(ref.collection, ref.key), id);
			}
		}
	};

	return {
		record,
		warm,
		get,
		keysIn: (collection) => [...(written.get(collection) ?? [])],
		touched: (collection) => written.has(collection),
	};
};

/**
 * Explains a ref that never resolved, naming the keys that do exist.
 *
 * A seed that never wrote to the collection at all is the much more common
 * mistake, so it gets its own sentence.
 *
 * @param ref The ref that could not be resolved.
 * @param store The run's index.
 */
export const describeUnresolved = (
	ref: DummyRef,
	store: DummyIndexStore,
): string => {
	if (!store.touched(ref.collection)) {
		return (
			`${describeRef(ref)}\n` +
			`      no seed wrote to "${ref.collection}", and the database has no ` +
			"document with that key"
		);
	}

	/* Three is enough to recognise a typo without printing a collection. */
	const known = store.keysIn(ref.collection);
	const listed = known.slice(0, 3).join(", ");
	const rest = known.length > 3 ? `, and ${String(known.length - 3)} more` : "";

	return (
		`${describeRef(ref)}\n` + `      "${ref.collection}" has: ${listed}${rest}`
	);
};
