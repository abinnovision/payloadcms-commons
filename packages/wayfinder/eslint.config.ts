import { defineConfig } from "eslint/config";
import {
	base,
	configFiles,
	nestjs,
	stylistic,
	vitest,
} from "@abinnovision/eslint-config-base";

/** Nothing in this package may reach for Next. Wayfinder is framework-agnostic. */
const noNext = {
	group: ["next", "next/*"],
	message:
		"wayfinder takes no dependency on Next. Caching and preview belong to the consumer, which supplies them through `loadMappings({ cache })` and `formatHref`.",
};

/**
 * The pattern and runtime layers back the `.` surface, which a consumer may
 * load anywhere. Payload arrives as an injected instance, so only its types
 * may cross.
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
		"lexical",
		"@lexical/*",
	],
	allowTypeImports: true,
	message:
		"The `.` surface takes its Payload instance as an argument. Only `import type` may cross into it.",
};

/** The config surface is loaded by the CLI, so React must not reach it. */
const configIsReactFree = {
	group: [
		"react",
		"react/*",
		"react-dom",
		"react-dom/*",
		"@payloadcms/ui",
		"@payloadcms/ui/*",
		"lexical",
		"@lexical/*",
	],
	allowTypeImports: true,
	message:
		"The ./config surface is loaded by `payload generate:types`, migrations and the CLI. Only `import type` may cross into it.",
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
		files: ["src/index.ts", "src/pattern/**/*.ts", "src/runtime/**/*.ts"],
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
				{ patterns: [noNext, configIsReactFree] },
			],
		},
	},
]);
