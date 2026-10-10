import { hasDraftsEnabled } from "payload/shared";

import { fail } from "./errors.js";
import { selectSeeds, sortSeeds } from "./graph.js";

import type { DummyReporter } from "./reporter.js";
import type { DummyNaturalKeys, DummyRunOptions, DummySeed } from "./types.js";
import type {
	CollectionSlug,
	GlobalSlug,
	Payload,
	SanitizedCollectionConfig,
} from "payload";

export interface NormalizedOptions {
	payload: Payload;
	/** Sorted, then narrowed by `only`. */
	seeds: readonly DummySeed[];
	/** Answers a collection's natural key, deriving it the first time. */
	keyFor: (collection: CollectionSlug) => string;
	/** The same, but answers undefined where a collection declares none. */
	optionalKeyFor: (collection: CollectionSlug) => string | undefined;
	/** Whether a write to this collection needs `_status` and `draft: false`. */
	collectionHasDrafts: (collection: CollectionSlug) => boolean;
	globalHasDrafts: (slug: GlobalSlug) => boolean;
	/** Whether a collection stores uploads, so `filePath` is accepted. */
	isUpload: (collection: CollectionSlug) => boolean;
	resetCollections: readonly CollectionSlug[];
	fresh: boolean;
	reporter: DummyReporter;
}

/*
 * A collection's natural key, from the one field it marks unique. Read from
 * `flattenedFields`, so a unique field hoisted out of a tab or a row counts.
 * An auth collection needs no special case: Payload already marks its `email`
 * unique. Two candidates is an error rather than a guess, because the wrong key
 * upserts the wrong document.
 */
const deriveKey = (
	collection: SanitizedCollectionConfig,
	override: string | undefined,
	/*
	 * An upload collection falls back to Payload's own `filename`, so having no
	 * unique field is an answer there rather than a failure. Ambiguity never is.
	 */
	optional: boolean,
): string | undefined => {
	if (override !== undefined) {
		return override;
	}

	const names = collection.flattenedFields.flatMap((field) =>
		"unique" in field && field.unique && "name" in field && field.name !== "id"
			? [field.name]
			: [],
	);
	const only = names[0];

	if (names.length === 1 && only !== undefined) {
		return only;
	}

	if (names.length > 1) {
		return fail(
			`Collection "${collection.slug}" has more than one unique field ` +
				`(${names.join(", ")}), so the natural key is ambiguous. Name one in ` +
				"naturalKeys.",
		);
	}

	return optional
		? undefined
		: fail(
				`Collection "${collection.slug}" has no unique field, so a seed ` +
					"cannot identify its documents across runs. Name one in " +
					"naturalKeys, and index it so the lookup stays cheap.",
			);
};

/**
 * Resolves a run's options, reading from the sanitized config whatever the
 * config already states.
 *
 * Only the genuinely ambiguous cases stay configuration: a collection's natural
 * key where it cannot be derived, and the reset order, which the seed graph
 * does not describe because seeds are not collections.
 *
 * @param options What the caller passed to the runner.
 */
export const normalizeOptions = (
	options: DummyRunOptions,
): NormalizedOptions => {
	const { payload } = options;
	const overrides: DummyNaturalKeys = options.naturalKeys ?? {};
	const keys = new Map<string, string>();

	const collectionConfig = (
		collection: CollectionSlug,
	): SanitizedCollectionConfig => {
		const found = payload.config.collections.find(
			(it) => it.slug === collection,
		);

		return (
			found ??
			fail(
				`There is no collection "${collection}". Collections: ` +
					`${payload.config.collections.map((it) => it.slug).join(", ")}.`,
			)
		);
	};

	const resolveKey = (
		collection: CollectionSlug,
		optional: boolean,
	): string | undefined => {
		const cached = keys.get(collection);

		if (cached !== undefined) {
			return cached;
		}

		const derived = deriveKey(
			collectionConfig(collection),
			overrides[collection],
			optional,
		);

		if (derived !== undefined) {
			keys.set(collection, derived);
		}

		return derived;
	};

	return {
		payload,
		seeds: selectSeeds(sortSeeds(options.seeds), options.only),
		/* Derived lazily, so an ambiguous collection a seed never touches is fine. */
		keyFor: (collection) => resolveKey(collection, false) as string,
		optionalKeyFor: (collection) => resolveKey(collection, true),
		collectionHasDrafts: (collection) =>
			hasDraftsEnabled(collectionConfig(collection)),
		globalHasDrafts: (slug) => {
			const found = payload.config.globals.find((it) => it.slug === slug);

			return found ? hasDraftsEnabled(found) : false;
		},
		isUpload: (collection) => Boolean(collectionConfig(collection).upload),
		resetCollections: options.resetCollections ?? [],
		fresh: options.fresh ?? false,
		reporter: options.reporter ?? {},
	};
};
