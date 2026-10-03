import { defineProject } from "vitest/config";

export default defineProject({
	test: {
		name: "@internal/test-utils#unit",
		include: ["src/**/*.spec.ts"],
		environment: "node",
	},
});
