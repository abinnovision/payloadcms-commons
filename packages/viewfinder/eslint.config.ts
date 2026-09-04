import { defineConfig } from "eslint/config";
import {
	base,
	configFiles,
	nestjs,
	stylistic,
	vitest,
} from "@abinnovision/eslint-config-base";

/** Nothing in this package may reach for Next. Viewfinder is framework-agnostic. */
const noNext = {
	group: ["next", "next/*"],
	message:
		"viewfinder takes no dependency on Next. It only needs the page in an iframe; routing and draft mode belong to the consumer.",
};

/**
 * The addressing layer is shared by the frontend bundle and the admin bundle,
 * so it must stay free of both React and the Payload runtime.
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
		"The `.` surface is the shared addressing layer, loaded by both the frontend and the admin bundle. Only `import type` may cross into it.",
};

export default defineConfig([
	{ extends: [base, nestjs, vitest, stylistic] },
	{ files: ["*.{c,m,}{t,j}s"], extends: [configFiles] },
	{
		rules: {
			// Symbols are exported inline on their declaration, so exports are
			// interleaved with the private helpers they sit next to.
			"import/exports-last": "off",
			"@typescript-eslint/no-restricted-imports": [
				"error",
				{ patterns: [noNext] },
			],
		},
	},
	{
		files: ["src/*.ts"],
		rules: {
			"@typescript-eslint/no-restricted-imports": [
				"error",
				{ patterns: [noNext, coreIsPlatformFree] },
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
						noNext,
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
