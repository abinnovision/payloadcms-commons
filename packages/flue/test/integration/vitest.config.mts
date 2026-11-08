import { payloadV4Resolver } from "@internal/test-utils/payload-v4";
import { fileURLToPath } from "node:url";
import { defineProject } from "vitest/config";

const exampleDir = fileURLToPath(
	new URL("../../../../apps/example-v4", import.meta.url),
);

// Absolute pattern so the project selects the same files whether vitest runs
// from the repo root or from the package directory.
const here = fileURLToPath(new URL(".", import.meta.url));

const cachePath = fileURLToPath(
	new URL("../../../../node_modules/.vitest-cache-v4", import.meta.url),
);

export default defineProject({
	plugins: [payloadV4Resolver(exampleDir)],
	test: {
		name: "@abinnovision/payloadcms-flue#integration",
		include: [`${here}**/*.spec.ts`],
		environment: "node",
		fsModuleCachePath: cachePath,
		testTimeout: 30_000,
		hookTimeout: 60_000,
		fileParallelism: false,
		// Every spec boots fresh in-memory databases. Payload skips the schema
		// push when the schema matches the previous boot in the same process,
		// which would leave a new database without tables.
		//
		// The package tests against Payload 4 while the repository root holds
		// Payload 3, so Payload's version check would flag the root's
		// `@payloadcms/*` packages from its background task.
		env: {
			PAYLOAD_FORCE_DRIZZLE_PUSH: "true",
			PAYLOAD_DISABLE_DEPENDENCY_CHECKER: "true",
		},
	},
});
