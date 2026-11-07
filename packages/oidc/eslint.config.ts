import { defineConfig } from "eslint/config";
import {
	base,
	configFiles,
	nestjs,
	stylistic,
	vitest,
} from "@abinnovision/eslint-config-base";

/** Payload 4 hands server components a framework adapter, so nothing here needs Next. */
const noNext = {
	group: ["next", "next/*"],
	message:
		"oidc takes no dependency on Next. Redirects and cookies go through Payload's server adapter (`server.redirect`, `server.getCookies`).",
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
				{
					patterns: [
						noNext,
						{
							group: ["react", "react/*", "@payloadcms/ui", "@payloadcms/ui/*"],
							allowTypeImports: true,
							message:
								"The `.` surface is loaded with the Payload config by the CLI, migrations and `generate:types`. Only `import type` may cross into it.",
						},
					],
				},
			],
		},
	},
]);
