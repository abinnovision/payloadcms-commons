import { defineProject } from "vitest/config";

export default defineProject({
	test: {
		name: "@abinnovision/payloadcms-hatchet#unit",
		include: ["src/**/*.spec.ts"],
		environment: "node",
	},
});
