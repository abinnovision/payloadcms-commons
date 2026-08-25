import { defineProject } from "vitest/config";

export default defineProject({
	test: {
		name: "@abinnovision/payloadcms-mcpx#unit",
		include: ["src/**/*.spec.ts", "src/**/*.spec.tsx"],
		environment: "node",
	},
});
