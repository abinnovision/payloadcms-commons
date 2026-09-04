import { getPayload } from "payload";

import { buildFixtureConfig } from "../../fixtures/payload-config.js";

import type { Payload } from "payload";

/** Cache key shared by `getPayload` within one file. */
export const CACHE_KEY = "montage-integration";

export const bootPayload = async (
	args: { key?: string } = {},
): Promise<Payload> => {
	const config = buildFixtureConfig();

	return await getPayload({ config, key: args.key ?? CACHE_KEY });
};
