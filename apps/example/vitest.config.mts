import { defineProject } from "vitest/config";

export default defineProject({
	test: {
		name: "@internal/example#unit",
		include: ["src/**/*.spec.ts", "src/**/*.spec.tsx"],
		environment: "node",
	},
});
