import { loadMappings } from "@abinnovision/payloadcms-wayfinder/config";
import config from "@payload-config";
import { getPayload } from "payload";

import type { PayloadCollectionMappingResolved } from "@abinnovision/payloadcms-wayfinder";

/**
 * The settings the mapping global was created with.
 *
 * Shared between the plugin and every read so the two cannot drift: writing
 * with one `localized` and reading with the other means writing to one shape
 * and reading another. This app has a `localization` block, so the mapping
 * holds one pattern per locale.
 */
export const WAYFINDER_OPTIONS = { localized: true } as const;

/**
 * Loads the compiled mappings without montage.
 *
 * The render path does not use this: it calls `initWayfinder` instead, which
 * parks the same result on montage's render context so every block on the
 * page shares one read. This is the standalone shape, kept for the parts of
 * the app that render no blocks — the preview route, and the fallback branch
 * of the catch-all.
 */
export const getMappings = async (): Promise<
	PayloadCollectionMappingResolved[]
> => {
	const payload = await getPayload({ config });

	return await loadMappings({ payload, ...WAYFINDER_OPTIONS });
};
