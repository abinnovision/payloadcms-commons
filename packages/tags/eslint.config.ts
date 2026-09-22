import { defineConfig } from "eslint/config";
import {
	base,
	configFiles,
	nestjs,
	stylistic,
	vitest,
} from "@abinnovision/eslint-config-base";

/**
 * The item model and the pure helpers are shared by the config graph and the
 * admin bundle, so `.` must stay free of both React and the Payload runtime.
 */
const coreIsPlatformFree = {
	group: [
		"react",
		"react/*",
		"react-dom",
		"react-dom/*",
		"payload",
		"payload/*",
		"@payloadcms/*",
	],
	allowTypeImports: true,
	message:
		"The `.` surface is loaded by the CLI through the config and by the admin bundle through the components. Only `import type` may cross into it.",
};

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
		files: ["src/*.ts"],
		rules: {
			"@typescript-eslint/no-restricted-imports": [
				"error",
				{ patterns: [coreIsPlatformFree] },
			],
		},
	},
	{
		files: ["src/config/**/*.ts"],
		rules: {
			"@typescript-eslint/no-restricted-imports": [
				"error",
				{
					patterns: [
						{
							group: [
								"react",
								"react/*",
								"react-dom",
								"react-dom/*",
								"@payloadcms/ui",
								"@payloadcms/ui/*",
							],
							allowTypeImports: true,
							message:
								"The ./config surface is loaded by `payload generate:types`, migrations and the CLI. Only `import type` may cross into it.",
						},
					],
				},
			],
		},
	},
]);
