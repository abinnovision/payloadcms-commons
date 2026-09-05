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
	 * collection's own pattern cannot name one. Decided here, and carried on
	 * every compiled mapping from here on.
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
	const localized = args.localized ?? Boolean(args.payload.config.localization);
	const cache = args.cache ?? defaultCache;

	const global = (await args.payload.findGlobal({
		slug: args.globalSlug ?? DEFAULT_MAPPING_GLOBAL_SLUG,
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

	const key = JSON.stringify([usable, args.fallbackIdentifierField]);
	const cached = cache.get(key);

	if (cached) {
		return cached;
	}

	const compiled = usable.flatMap((mapping) => {
		try {
			return [resolveCollectionMapping(mapping, args.fallbackIdentifierField)];
		} catch {
			// An unparseable pattern was saved before validation tightened.
			return [];
		}
	});

	cache.set(key, compiled);

	return compiled;
};
