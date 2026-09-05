import { loadMappings } from "@abinnovision/payloadcms-wayfinder/config";
import config from "@payload-config";
import { getPayload } from "payload";

import type { PayloadCollectionMappingResolved } from "@abinnovision/payloadcms-wayfinder";

/**
 * The settings the mapping global was created with.
 *
 * Shared between the plugin and every read so the two cannot drift: writing
 * with one `localized` and reading with the other means writing to one shape
 * and reading another.
 */
export const WAYFINDER_OPTIONS = { localized: false } as const;

/**
 * Loads the compiled mappings.
 *
 * Wrapped rather than called directly so the caching decision lives in one
 * place. `loadMappings` memoises compilation in process; a deployment that
 * wants to skip the read as well passes its own cache adapter here.
 */
export const getMappings = async (): Promise<
	PayloadCollectionMappingResolved[]
> => {
	const payload = await getPayload({ config });

	return await loadMappings({ payload, ...WAYFINDER_OPTIONS });
};
