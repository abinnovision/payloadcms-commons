import { base, configFiles } from "@abinnovision/eslint-config-base";
import { defineConfig } from "eslint/config";

export default defineConfig([
	{ extends: [base] },
	{ files: ["*.{c,m,}{t,j}s"], extends: [configFiles] },
	{
		ignores: [
			"src/app/(payload)/admin/importMap.js",
			"src/payload-types.ts",
			".next/**",
		],
	},
]);
