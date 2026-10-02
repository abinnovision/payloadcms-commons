import { getPayload } from "payload";

import { buildFixtureConfig } from "../../fixtures/config.js";

import type { Payload } from "payload";

/**
 * `getPayload` caches by `key`; vitest isolates modules per spec file, so this
 * fixed key still yields a separate instance and a clean database per file.
 */
export const bootPayload = async (): Promise<Payload> => {
	const config = buildFixtureConfig();

	return await getPayload({ config, key: "tags-integration" });
};
