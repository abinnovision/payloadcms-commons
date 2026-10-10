import type { DummyReporter } from "./reporter.js";
import type {
	CollectionSlug,
	DataFromGlobalSlug,
	GlobalSlug,
	Payload,
	RequiredDataFromCollectionSlug,
	TypedLocale,
} from "payload";

/**
 * A document's id.
 *
 * SQLite and Postgres number their rows, Mongo strings them, so an id is
 * substituted as Payload stored it. Coercing it would make a relationship fail
 * validation against a numeric primary key.
 */
export type DummyDocumentId = number | string;

/**
 * A document addressed by its natural key rather than its id. Built by
 * {@link dummyRef} or {@link dummyPolyRef} and substituted at write time, so a
 * data file can name a document before it exists.
 */
export interface DummyRef {
	/** `"polymorphic"` resolves to `{ relationTo, value }` instead of a bare id. */
	readonly __dummyRef: "id" | "polymorphic";
	readonly collection: CollectionSlug;
	readonly key: string;
}

/**
 * A collection's or global's data with a {@link DummyRef} admitted wherever a
 * value sits, which is what lets a ref typecheck inside a block, an array row
 * or a rich text link node.
 *
 * A ref is admitted at every leaf rather than only at relationships: in the
 * generated types a relationship id and a text field are both `string`, so
 * there is no type-level signal to discriminate on.
 */
export type DummyData<T> = T extends DummyRef
	? T
	: T extends (...args: never[]) => unknown
		? T
		: T extends Date
			? Date | DummyRef
			: T extends (infer TItem)[]
				? DummyData<TItem>[] | DummyRef
				: T extends object
					? { [K in keyof T]: DummyData<T[K]> } | DummyRef
					: DummyRef | T;

/**
 * A locale a seed can write.
 *
 * `TypedLocale` admits `null` until the generated types augment it, which is
 * not a usable record key, so the null is dropped. In an app with generated
 * types this still narrows to that app's locales.
 */
export type DummyLocale = Extract<TypedLocale, string>;

/**
 * The field that identifies a seeded document across runs, per collection.
 *
 * Only needed where it cannot be derived: a collection with no unique field, or
 * with more than one.
 */
export type DummyNaturalKeys = {
	[K in CollectionSlug]?: keyof RequiredDataFromCollectionSlug<K> & string;
};

export interface DummyDocOptions<TSlug extends CollectionSlug> {
	/**
	 * Written after the default locale, as a partial over it. Each pass carries
	 * the stored row ids, so a localized array keeps the other locales' rows.
	 *
	 * An array in an override must have the same length and order as the
	 * default locale's, because position is the only correspondence available.
	 */
	locales?:
		| Partial<
				Record<
					DummyLocale,
					DummyData<Partial<RequiredDataFromCollectionSlug<TSlug>>>
				>
		  >
		| undefined;
}

export interface DummyGlobalOptions<TSlug extends GlobalSlug> {
	/**
	 * Names a field that, once it carries a value, means an editor has authored
	 * this global and the seed leaves it alone.
	 */
	keepIfSet?: (keyof DataFromGlobalSlug<TSlug> & string) | undefined;
	locales?:
		| Partial<
				Record<DummyLocale, DummyData<Partial<DataFromGlobalSlug<TSlug>>>>
		  >
		| undefined;
}

/** What a seed's `run` is handed. Every write goes through it. */
export interface DummyContext {
	/**
	 * Upserts a document by its natural key and answers its id.
	 *
	 * A ref naming something not yet written is pruned from this write, and the
	 * whole call is replayed once every seed has run.
	 */
	doc: <TSlug extends CollectionSlug>(
		collection: TSlug,
		data: DummyData<RequiredDataFromCollectionSlug<TSlug>>,
		options?: DummyDocOptions<TSlug>,
	) => Promise<DummyDocumentId>;
	/**
	 * Uploads a local file, reusing an existing document for the same basename.
	 * The basename is the upload's natural key, so `ref(collection, basename)`
	 * addresses it without `data` carrying one.
	 */
	upload: <TSlug extends CollectionSlug>(
		collection: TSlug,
		filePath: string,
		data?: DummyData<Partial<RequiredDataFromCollectionSlug<TSlug>>>,
	) => Promise<DummyDocumentId>;
	/** Overwrites a global, unless `keepIfSet` says an editor has claimed it. */
	global: <TSlug extends GlobalSlug>(
		slug: TSlug,
		data: DummyData<Omit<DataFromGlobalSlug<TSlug>, "id">>,
		options?: DummyGlobalOptions<TSlug>,
	) => Promise<void>;
	/** {@link dummyRef}, so a seed does not have to import it. */
	ref: (collection: CollectionSlug, key: string) => DummyRef;
	/** {@link dummyPolyRef}, for a polymorphic relationship or a link node. */
	polyRef: (collection: CollectionSlug, key: string) => DummyRef;
	/** The escape hatch for an operation the writer does not cover. */
	payload: Payload;
}

/**
 * One unit of seeding. `id` is how other seeds name it and how `--only`
 * selects it; `dependsOn` only orders the run, a ref does not need an edge.
 */
export interface DummySeed {
	id: string;
	dependsOn?: readonly string[] | undefined;
	run: (ctx: DummyContext) => Promise<void>;
}

export interface DummyRunOptions {
	payload: Payload;
	seeds: readonly DummySeed[];
	/** Overrides the key derived from a collection's unique fields. */
	naturalKeys?: DummyNaturalKeys | undefined;
	/** Emptied before the first seed when `fresh`, in reverse dependency order. */
	resetCollections?: readonly CollectionSlug[] | undefined;
	fresh?: boolean | undefined;
	/** Runs only these seeds, without pulling in their dependencies. */
	only?: readonly string[] | undefined;
	reporter?: DummyReporter | undefined;
}

export interface DummyWriteTally {
	created: number;
	updated: number;
	skipped: number;
	deleted: number;
}

export interface DummyRunResult {
	durationMs: number;
	/** In the order they ran. */
	seeds: readonly string[];
	writes: ReadonlyMap<string, DummyWriteTally>;
	/** Documents whose refs pointed forward and were completed by the replay. */
	replayed: number;
}
