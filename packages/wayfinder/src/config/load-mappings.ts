import { DEFAULT_MAPPING_GLOBAL_SLUG } from "./mapping-global.js";
import { resolveCollectionMapping } from "../pattern/resolver.js";

import type {
	PayloadCollectionMapping,
	PayloadCollectionMappingResolved,
} from "../pattern/types.js";
import type { Payload } from "payload";

/**
 * Somewhere to keep compiled mappings between reads.
 *
 * This caches compilation, not the read: the key is derived from what the read
 * returned, which is what makes it impossible to serve a stale mapping, and
 * also means the read always happens. To skip the read as well, wrap the whole
 * `loadMappings` call in your own framework cache and invalidate it from
 * `createMappingGlobal({ onChange })`.
 */
export interface MappingCache {
	get: (key: string) => PayloadCollectionMappingResolved[] | undefined;
	set: (key: string, value: PayloadCollectionMappingResolved[]) => void;
}

/** Process-lifetime memo, used when no cache is supplied. */
const createMemoryCache = (): MappingCache => {
	const store = new Map<string, PayloadCollectionMappingResolved[]>();

	return {
		get: (key) => store.get(key),
		set: (key, value) => void store.set(key, value),
	};
};

const defaultCache = createMemoryCache();

/**
 * Reads what {@link createMappingGlobal} was told, off the global's own config.
 *
 * The write side validates patterns against this and the read side compiles
 * mappings with it, so the two have to agree. Carrying it on the config means
 * a project states it where it declares the global and nowhere else.
 */
const declaredIdentifierField = (
	payload: Payload,
	slug: string,
): string | undefined => {
	const custom = payload.config.globals.find((it) => it.slug === slug)?.custom;

	const declared = (
		custom as { wayfinder?: { fallbackIdentifierField?: unknown } } | undefined
	)?.wayfinder?.fallbackIdentifierField;

	return typeof declared === "string" ? declared : undefined;
};

interface MappingRow {
	collectionName?: unknown;
	path?: unknown;
}

export interface LoadMappingsArgs {
	payload: Payload;
	globalSlug?: string;
	/**
	 * Whether patterns are per-locale.
	 *
	 * Derived from the instance's own `localization` config, which is the same
	 * authority `wayfinderPlugin` derives it from, so the two sides cannot
	 * disagree. Set it only to override that, and then on both sides.
	 */
	localized?: boolean;
	/**
	 * The field a relationship parameter falls back to when the target
	 * collection's own pattern cannot name one.
	 *
	 * Read off the mapping global's own config when the plugin was given it,
	 * so a project states it once, where the global is declared, and both the
	 * save-time validation and the compiled mappings get the same answer. Set
	 * it here only to override that.
	 */
	fallbackIdentifierField?: string;
	/** Reuses compiled patterns across reads. @see MappingCache */
	cache?: MappingCache;
}

/**
 * Reads the mapping global and compiles it.
 *
 * Returns an empty list rather than throwing when the global has never been
 * saved, which is the state every project is in on its first boot. A missing
 * row, an unregistered collection or a locale with no pattern is skipped for
 * the same reason: routing should degrade to "nothing matches", not to a
 * crash on the way to the admin panel where an editor would fix it.
 *
 * @param args The Payload instance and mapping-global settings.
 */
export const loadMappings = async (
	args: LoadMappingsArgs,
): Promise<PayloadCollectionMappingResolved[]> => {
	const slug = args.globalSlug ?? DEFAULT_MAPPING_GLOBAL_SLUG;
	const localized = args.localized ?? Boolean(args.payload.config.localization);
	const cache = args.cache ?? defaultCache;

	const fallbackIdentifierField =
		args.fallbackIdentifierField ?? declaredIdentifierField(args.payload, slug);

	const global = (await args.payload.findGlobal({
		slug,
		depth: 0,
		overrideAccess: true,
		...(localized ? { locale: "all" as const } : {}),
	})) as { collections?: unknown } | undefined;

	const rows = Array.isArray(global?.collections)
		? (global.collections as MappingRow[])
		: [];

	const usable = rows.flatMap((row): PayloadCollectionMapping[] => {
		const collection = row.collectionName;
		const path = row.path;

		if (typeof collection !== "string" || collection === "") {
			return [];
		}

		if (typeof path === "string") {
			return [{ collection, path }];
		}

		if (!path || typeof path !== "object") {
			return [];
		}

		const patterns = Object.fromEntries(
			Object.entries(path as Record<string, unknown>).flatMap(
				([locale, pattern]) =>
					typeof pattern === "string" && pattern !== ""
						? [[locale, pattern] as const]
						: [],
			),
		);

		return Object.keys(patterns).length > 0
			? [{ collection, path: patterns }]
			: [];
	});

	const key = JSON.stringify([usable, fallbackIdentifierField]);
	const cached = cache.get(key);

	if (cached) {
		return cached;
	}

	const compiled = usable.flatMap((mapping) => {
		try {
			return [resolveCollectionMapping(mapping, fallbackIdentifierField)];
		} catch {
			// An unparseable pattern was saved before validation tightened.
			return [];
		}
	});

	cache.set(key, compiled);

	return compiled;
};
