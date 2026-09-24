import { getPayload } from "payload";

import { buildFixtureConfig } from "../fixtures/config.js";

import type { Payload } from "payload";

/**
 * `getPayload` caches by `key`, and this fixture's sqlite database is
 * in-memory, so a distinct key per spec file yields a genuinely separate
 * instance and a clean database.
 */
export const bootPayload = (key: string): Promise<Payload> => {
	const config = buildFixtureConfig();

	return getPayload({ config, key });
};

export const USER = { email: "tags@example.com", password: "tags-secret" };
