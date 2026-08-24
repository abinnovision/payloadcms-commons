import { defineProject } from "vitest/config";

export default defineProject({
	test: {
		name: "@abinnovision/payloadcms-email-lettermint#unit",
		include: ["src/**/*.spec.ts"],
		environment: "node",
	},
});
