import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		projects: [
			"apps/*/vitest.config.{m,}ts",
			"packages/*/vitest.config.{m,}ts",
			"packages/*/test/{integration,e2e}/vitest.config.{m,}ts",
		],
		coverage: {
			provider: "v8",
			include: ["packages/*/src/**/*.{ts,tsx}"],
			reporter: [["lcovonly", { projectRoot: "./" }], "text"],
		},
	},
});
