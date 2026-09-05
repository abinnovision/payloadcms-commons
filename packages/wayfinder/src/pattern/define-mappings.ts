import { resolveCollectionMapping } from "./resolver.js";

import type {
	PayloadCollectionMapping,
	PayloadCollectionMappingResolved,
} from "./types.js";

/**
 * Compiles a code-defined collection map.
 *
 * Every runtime function takes its mappings as plain data, so the CMS-authored
 * global is one way to produce them and this is the other. Reach for it when
 * routing is fixed at build time, when a project has no admin panel, or in
 * tests — none of which should have to stand up a global first.
 *
 * @param mappings The collection-to-pattern map.
 * @param options Where a relationship parameter falls back to when the target
 *   collection's own pattern cannot name an identifier.
 */
export const defineMappings = (
	mappings: PayloadCollectionMapping[],
	options: { fallbackIdentifierField?: string } = {},
): PayloadCollectionMappingResolved[] =>
	mappings.map((mapping) =>
		resolveCollectionMapping(mapping, options.fallbackIdentifierField),
	);
