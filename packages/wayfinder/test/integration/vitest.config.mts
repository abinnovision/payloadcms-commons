import { fileURLToPath } from "node:url";
import { defineProject } from "vitest/config";

const here = fileURLToPath(new URL(".", import.meta.url));

export default defineProject({
	test: {
		name: "@abinnovision/payloadcms-wayfinder#integration",
		include: [`${here}**/*.spec.ts`],
		environment: "node",
		testTimeout: 30_000,
		hookTimeout: 60_000,
		fileParallelism: false,
	},
});
