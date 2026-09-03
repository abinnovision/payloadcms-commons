import { defineConfig } from "eslint/config";
import {
	base,
	configFiles,
	nestjs,
	stylistic,
	vitest,
} from "@abinnovision/eslint-config-base";

/** Nothing in this package may reach for Next. The renderer is plain RSC. */
const noNext = {
	group: ["next", "next/*"],
	message:
		"montage takes no dependency on Next. Route Link/Image/locale/draft through the render context instead.",
};

export default defineConfig([
	{ extends: [base, nestjs, vitest, stylistic] },
	{ files: ["*.{c,m,}{t,j}s"], extends: [configFiles] },
	{
		rules: {
			// Symbols are exported inline on their declaration, so exports are
			// interleaved with the private helpers they sit next to.
			"import/exports-last": "off",
			"@typescript-eslint/no-restricted-imports": ["error", { patterns: [noNext] }],
		},
	},
	{
		files: ["src/config/**/*.ts"],
		rules: {
			"@typescript-eslint/no-restricted-imports": [
				"error",
				{
					patterns: [
						noNext,
						{
							group: [
								"react",
								"react/*",
								"react-dom",
								"react-dom/*",
								"@payloadcms/richtext-lexical",
								"@payloadcms/richtext-lexical/*",
								"../*",
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
