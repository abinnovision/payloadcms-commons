import { defineProject } from "vitest/config";

export default defineProject({
	root: "../..",
	test: {
		name: "@abinnovision/payloadcms-mcpx#integration",
		include: ["test/integration/**/*.spec.ts"],
		environment: "node",
		testTimeout: 30_000,
		hookTimeout: 60_000,
		fileParallelism: false,
	},
});
