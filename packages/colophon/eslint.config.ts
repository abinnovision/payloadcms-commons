import { defineConfig } from "eslint/config";
import {
	base,
	configFiles,
	nestjs,
	stylistic,
	vitest,
} from "@abinnovision/eslint-config-base";

/** Nothing in this package may reach for Next. Colophon reads the process it runs in. */
const noNext = {
	group: ["next", "next/*"],
	message:
		"colophon takes no dependency on Next. It reads the environment of the running process, which is why it needs nothing from the framework around it.",
};

/**
 * The item model is shared by the config graph and the admin bundle, so it
 * must stay free of both React and the Payload runtime.
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
		"The `.` surface is the shared item model, loaded by the CLI through the config and by the admin bundle through the component. Only `import type` may cross into it.",
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
