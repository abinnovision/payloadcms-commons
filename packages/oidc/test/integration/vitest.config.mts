import { fileURLToPath } from "node:url";
import { defineProject } from "vitest/config";

// Absolute pattern so the project selects the same files whether vitest runs
// from the repo root or from the package directory.
const here = fileURLToPath(new URL(".", import.meta.url));

export default defineProject({
	test: {
		name: "@abinnovision/payloadcms-oidc#integration",
		include: [`${here}**/*.spec.ts`],
		environment: "node",
		testTimeout: 30_000,
		hookTimeout: 60_000,
		fileParallelism: false,
		// Every spec boots fresh in-memory databases. Payload skips the schema
		// push when the schema matches the previous boot in the same process,
		// which would leave a new database without tables.
		env: { PAYLOAD_FORCE_DRIZZLE_PUSH: "true" },
	},
});
