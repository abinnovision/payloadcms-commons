import { existsSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { walkModuleGraph } from "../test/module-graph.js";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The layering, keyed by file or by directory (trailing slash). A file may
 * import its own layer and the ones below it. Several layers are single files
 * in src/, which is why this is a map rather than a list of directories.
 */
const LAYERS: Record<string, number> = {
	"types.ts": 0,
	"result.ts": 0,
	"request.ts": 0,
	"version.ts": 0,
	"i18n.ts": 0,
	"guards.ts": 0,
	"entity.ts": 0,
	"builtin-tool-names.ts": 0,
	"define-tool.ts": 0,
	"capabilities.ts": 1,
	"options.ts": 1,
	"schema/": 1,
	"write/": 2,
	"api-keys/": 2,
	"auth/": 3,
	"tools/": 3,
	"endpoint/": 4,
	"plugin.ts": 5,
	"index.ts": 5,
};

/**
 * `./client` ships to the browser, so it stands outside the layering and may
 * reach only these, all plain data and pure functions. The list is written
 * twice more: the `no-restricted-imports` rule in eslint.config.ts, and the
 * walk src/client/module-boundary.spec.ts expects. A change belongs in all
 * three.
 */
const CLIENT = "client/";
const CLIENT_MAY_IMPORT = [
	"api-keys/capability-matrix.ts",
	"api-keys/setup-guide.ts",
	"capabilities.ts",
];

const pathOf = (file: string): string => relative(here, file);

const layerOf = (file: string): number | undefined => {
	const path = pathOf(file);

	return LAYERS[path] ?? LAYERS[`${path.split("/")[0]!}/`];
};

const isClient = (file: string): boolean => pathOf(file).startsWith(CLIENT);

const sourceFiles = readdirSync(here, { recursive: true, encoding: "utf8" })
	.filter((name) => /\.tsx?$/.test(name) && !name.includes(".spec."))
	.map((name) => resolve(here, name));

/*
 * Type-only imports are followed, unlike in the module boundary specs. Those
 * are about what reaches a bundle, where a type erases; this is about design,
 * where naming a higher layer's type is a dependency in the forbidden
 * direction all the same.
 */
const importsOf = (file: string): string[] => [
	...(walkModuleGraph(file, { includeTypeImports: true }).imports.get(file) ??
		[]),
];

const forbiddenImports = (file: string, layer: number): string[] =>
	importsOf(file)
		.filter((target) => isClient(target) || (layerOf(target) ?? 0) > layer)
		.map((target) => `${pathOf(file)} -> ${pathOf(target)}`);

const forbiddenClientImports = (
	file: string,
	allowed: string[] = CLIENT_MAY_IMPORT,
): string[] =>
	importsOf(file)
		.filter((target) => !isClient(target) && !allowed.includes(pathOf(target)))
		.map((target) => `${pathOf(file)} -> ${pathOf(target)}`);

describe("layer boundaries", () => {
	it("finds server and client files to check", () => {
		expect(sourceFiles.filter((file) => !isClient(file))).not.toEqual([]);
		expect(sourceFiles.filter(isClient)).not.toEqual([]);
	});

	it("names only files and directories that exist", () => {
		expect(
			[...Object.keys(LAYERS), ...CLIENT_MAY_IMPORT].filter(
				(path) => !existsSync(resolve(here, path)),
			),
		).toEqual([]);
	});

	it("assigns every source file to a layer or to client", () => {
		expect(
			sourceFiles
				.filter((file) => !isClient(file) && layerOf(file) === undefined)
				.map(pathOf),
		).toEqual([]);
	});

	it("imports only the same or lower layers", () => {
		expect(
			sourceFiles
				.filter((file) => !isClient(file))
				.flatMap((file) => forbiddenImports(file, layerOf(file)!)),
		).toEqual([]);
	});

	it("keeps client to its allowed imports", () => {
		expect(
			sourceFiles
				.filter(isClient)
				.flatMap((file) => forbiddenClientImports(file)),
		).toEqual([]);
	});

	/*
	 * Guards against the layer check passing because type-only edges are
	 * invisible: auth/resolve.ts reaches options.ts through `import type`
	 * alone, which must be flagged once the file is held to layer 0.
	 */
	it("sees a forbidden type-only edge", () => {
		const resolver = resolve(here, "auth", "resolve.ts");
		const valueImports = walkModuleGraph(resolver).imports.get(resolver);

		expect([...(valueImports ?? [])].map(pathOf)).not.toContain("options.ts");
		expect(forbiddenImports(resolver, 0)).toContain(
			"auth/resolve.ts -> options.ts",
		);
	});

	it("sees a client import outside the allowed list", () => {
		expect(
			forbiddenClientImports(
				resolve(here, "client", "capability-matrix.tsx"),
				[],
			),
		).toContain("client/capability-matrix.tsx -> capabilities.ts");
	});
});
