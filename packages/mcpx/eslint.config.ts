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
		files: ["src/client/**/*.{ts,tsx}"],
		ignores: ["src/client/**/*.spec.{ts,tsx}"],
		rules: {
			"@typescript-eslint/no-restricted-imports": [
				"error",
				{
					patterns: [
						{
							group: ["payload", "payload/*"],
							allowTypeImports: true,
							message:
								"./client ships to the browser through the admin import map. Only `import type` may cross into it from payload.",
						},
						{
							group: [
								"node:*",
								"zod",
								"zod/*",
								"@modelcontextprotocol/sdk",
								"@modelcontextprotocol/sdk/*",
							],
							message:
								"./client ships to the browser through the admin import map, so nothing server-side may reach it.",
						},
						{
							regex:
								"^\\.\\./(?!(?:api-keys/capability-matrix|api-keys/setup-guide|capabilities)\\.js$)",
							message:
								"./client may import only api-keys/capability-matrix, api-keys/setup-guide and capabilities from the rest of src/, which are plain data and pure functions.",
						},
					],
				},
			],
		},
	},
]);
