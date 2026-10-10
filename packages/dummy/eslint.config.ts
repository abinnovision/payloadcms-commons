import { defineConfig } from "eslint/config";
import {
	base,
	configFiles,
	nestjs,
	stylistic,
	vitest,
} from "@abinnovision/eslint-config-base";

export default defineConfig([
	{ extends: [base, nestjs, vitest, stylistic] },
	{ files: ["*.{c,m,}{t,j}s"], extends: [configFiles] },
	{
		rules: {
			// Symbols are exported inline on their declaration, so exports are
			// interleaved with the private helpers they sit next to.
			"import/exports-last": "off",
		},
	},
	{
		files: ["src/**/*.ts"],
		ignores: ["src/cli/**/*.ts"],
		rules: {
			"@typescript-eslint/no-restricted-imports": [
				"error",
				{
					paths: [
						{
							name: "node:process",
							message:
								"The `.` surface runs inside the caller's process, which may be a Next route or a test. Reading argv, writing to stdout and choosing an exit code belong to ./cli.",
						},
					],
				},
			],
		},
	},
]);
