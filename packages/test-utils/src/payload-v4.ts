import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import type { Plugin } from "vite";

const defaultExampleDir = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	"../../../apps/example-v4",
);

const PAYLOAD_SPECIFIER = /^(payload|@payloadcms\/[^/]+)(\/.*)?$/;
const OPTIONAL_SPECIFIER = /^(react|react-dom|lexical|@lexical\/[^/]+)(\/.*)?$/;

/**
 * The version of `payload` installed in the example app.
 */
export const payloadVersion = (exampleDir: string): string => {
	const manifest = path.join(exampleDir, "node_modules/payload/package.json");

	return (JSON.parse(readFileSync(manifest, "utf8")) as { version: string })
		.version;
};

const isUnder = (file: string, dir: string): boolean =>
	file === dir || file.startsWith(dir + path.sep);

/**
 * Resolves Payload and its peers from the example app, so a test run loads v4
 * while the workspace itself stays on v3. A specifier that does not resolve
 * inside the example app fails instead of falling back to the workspace copy.
 */
export const payloadV4Resolver = (exampleDir = defaultExampleDir): Plugin => {
	const importer = path.join(exampleDir, "package.json");

	return {
		name: "payload-v4-resolver",
		enforce: "pre",
		async resolveId(id, _importer, options) {
			const payloadMatch = PAYLOAD_SPECIFIER.exec(id);
			const match = payloadMatch ?? OPTIONAL_SPECIFIER.exec(id);
			if (!match) {
				return null;
			}

			// Peers are redirected only when the example app installs its own copy.
			if (
				!payloadMatch &&
				!existsSync(path.join(exampleDir, "node_modules", match[1] ?? id))
			) {
				return null;
			}

			const resolved = await this.resolve(id, importer, {
				...options,
				skipSelf: true,
			});

			if (!resolved || !isUnder(resolved.id, exampleDir)) {
				throw new Error(
					`"${id}" did not resolve inside ${exampleDir} (got ${resolved?.id ?? "null"})`,
				);
			}

			return resolved;
		},
	};
};
