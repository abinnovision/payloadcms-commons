import { readdirSync } from "node:fs";
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
 * reach only these, all plain data and pure functions.
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

describe("layer boundaries", () => {
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
			sourceFiles.filter(isClient).flatMap((file) =>
				importsOf(file)
					.filter(
						(target) =>
							!isClient(target) && !CLIENT_MAY_IMPORT.includes(pathOf(target)),
					)
					.map((target) => `${pathOf(file)} -> ${pathOf(target)}`),
			),
		).toEqual([]);
	});

	it("sees a forbidden edge if one is introduced (sanity check)", () => {
		/*
		 * Guards against the assertions above passing because the walk found
		 * nothing. Held to layer 1, patchDocument's imports of write/ must be
		 * flagged, which proves cross-layer edges are visible at all.
		 */
		expect(
			forbiddenImports(resolve(here, "tools", "patch-document.ts"), 1),
		).toContain("tools/patch-document.ts -> write/patch.ts");
	});
});
