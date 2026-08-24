import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { buildConfig } from "payload";

import { lettermintAdapter } from "../../src/index.js";

import type { LettermintAdapterArgs } from "../../src/index.js";
import type { CollectionConfig, SanitizedConfig } from "payload";

const users: CollectionConfig = {
	slug: "users",
	auth: true,
	fields: [],
};

const adapterArgs: LettermintAdapterArgs = {
	apiToken: "lm_integration",
	defaultFromAddress: "no-reply@example.com",
	defaultFromName: "Example CMS",
	route: "outgoing",
};

/**
 * A sanitized config wired to the adapter. No rich text field is declared, so
 * no editor is needed.
 */
const buildFixtureConfig = (
	overrides: Partial<LettermintAdapterArgs> = {},
): Promise<SanitizedConfig> =>
	buildConfig({
		secret: "lettermint-test-secret",
		db: sqliteAdapter({ client: { url: ":memory:" } }),
		collections: [users],
		email: lettermintAdapter({ ...adapterArgs, ...overrides }),
		typescript: { autoGenerate: false },
		graphQL: { disable: true },
	});

export { buildFixtureConfig };
