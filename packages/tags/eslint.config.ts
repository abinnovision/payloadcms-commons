import { defineConfig } from "eslint/config";
import {
	base,
	configFiles,
	nestjs,
	stylistic,
	vitest,
} from "@abinnovision/eslint-config-base";

/** Nothing in this package may reach for Next. Tags is loaded from payload.config.ts and from Payload's own admin bundle, neither of which is Next-specific. */
const noNext = {
	group: ["next", "next/*"],
	message:
		"payloadcms-tags takes no dependency on Next. It is loaded from the Payload config graph and from Payload's own admin bundle, so it needs nothing from the framework around either.",
};

/**
 * The shared layer, color handling, client-side search and selection, the
 * permission check and the list-cell model, is reached by both halves of the
 * package, so `.` must stay free of both React and the Payload runtime.
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
