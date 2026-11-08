import { defineConfig } from "eslint/config";
import {
	base,
	configFiles,
	nestjs,
	stylistic,
	vitest,
} from "@abinnovision/eslint-config-base";

/*
 * Each entry runs in a different process: `.` in the Payload server, `./admin`
 * in the browser, `./agent` in the Flue sidecar. The rules below keep each
 * file to what its runtime provides. The same lists are walked transitively
 * by src/layering.spec.ts and the module boundary specs; a change belongs in
 * all of them.
 */

const onlyProtocol = (entry: string) => ({
	regex: "^\\.\\./(?!protocol/[\\w-]+\\.js$)",
	message: `${entry} may import only protocol/ from the rest of src/, which is dependency-free.`,
});

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
		ignores: [
			"src/admin/**",
			"src/agent/**",
			"src/protocol/**",
			"src/**/*.spec.ts",
		],
		rules: {
			"@typescript-eslint/no-restricted-imports": [
				"error",
				{
					patterns: [
						{
							group: [
								"@flue/*",
								"valibot",
								"valibot/*",
								"react",
								"react/*",
								"@payloadcms/ui",
								"@payloadcms/ui/*",
								"@assistant-ui/*",
							],
							message:
								"The `.` entry is loaded with the Payload config by the server and the CLI. The sidecar and admin dependencies belong to ./agent and ./admin.",
						},
					],
				},
			],
		},
	},
	{
		files: ["src/admin/**/*.{ts,tsx}"],
		ignores: ["src/admin/**/*.spec.{ts,tsx}"],
		rules: {
			"@typescript-eslint/no-restricted-imports": [
				"error",
				{
					patterns: [
						{
							group: ["payload", "payload/*"],
							allowTypeImports: true,
							message:
								"./admin ships to the browser through the admin import map. Only `import type` may cross into it from payload.",
						},
						{
							group: [
								"node:*",
								"next",
								"next/*",
								"@flue/*",
								"!@flue/sdk",
								"valibot",
								"valibot/*",
							],
							message:
								"./admin ships to the browser and uses Payload's router wrappers, so neither server, Next nor sidecar code may reach it. Of Flue, only the browser SDK @flue/sdk may.",
						},
						onlyProtocol("./admin"),
					],
				},
			],
		},
	},
	{
		files: ["src/agent/**/*.ts"],
		ignores: ["src/agent/**/*.spec.ts"],
		rules: {
			"@typescript-eslint/no-restricted-imports": [
				"error",
				{
					patterns: [
						{
							group: [
								"payload",
								"payload/*",
								"@payloadcms/*",
								"react",
								"react/*",
								"@assistant-ui/*",
								"node:*",
							],
							message:
								"./agent runs in the Flue sidecar, which installs no Payload and reaches Payload only through mcpx. Not even `import type` may cross from payload.",
						},
						onlyProtocol("./agent"),
					],
				},
			],
		},
	},
	{
		files: ["src/protocol/**/*.ts"],
		ignores: ["src/protocol/**/*.spec.ts"],
		rules: {
			"@typescript-eslint/no-restricted-imports": [
				"error",
				{
					patterns: [
						{
							regex: "^[^.]",
							message:
								"protocol/ is shared by all three entries and stays dependency-free.",
						},
						{
							regex: "^\\.\\./",
							message: "protocol/ imports nothing from the rest of src/.",
						},
					],
				},
			],
		},
	},
]);
