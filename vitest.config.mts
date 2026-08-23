import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		projects: [
			// Placeholder project which keeps the workspace resolvable while no
			// package exists yet. Remove it once the first package is added.
			{ test: { name: "root#unit", include: [] } },
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
