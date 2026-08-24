import { getPayload } from "payload";

import { buildFixtureConfig } from "../../fixtures/config.js";

import type { LettermintAdapterArgs } from "../../../src/index.js";
import type { Payload } from "payload";

/**
 * Boots Payload against a fresh in-memory database. `getPayload` caches by
 * `key`, so every spec that needs its own adapter configuration passes a
 * distinct one.
 */
const bootPayload = async (
	key: string,
	overrides: Partial<LettermintAdapterArgs> = {},
): Promise<Payload> =>
	await getPayload({
		config: await buildFixtureConfig(overrides),
		key,
	});

export { bootPayload };
