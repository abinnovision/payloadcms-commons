import { defineProject } from "vitest/config";

export default defineProject({
	test: {
		name: "@internal/example-v3#unit",
		include: ["src/**/*.spec.ts", "src/**/*.spec.tsx"],
		environment: "node",
	},
});
