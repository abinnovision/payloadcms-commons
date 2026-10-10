import { walkModuleGraph } from "@internal/test-utils/module-graph";
import { existsSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The layering, keyed by file or by directory (trailing slash). A file may
 * import its own layer and the ones below it.
 *
 * The point of the order is that deciding what to write never depends on
 * writing it: the graph, the ref walk and the options sit below the writer, so
 * they stay testable without a database.
 */
const LAYERS: Record<string, number> = {
	"types.ts": 0,
	"errors.ts": 0,
	"ref.ts": 0,
	"walk.ts": 0,
	"reporter.ts": 0,
	"define-seed.ts": 0,
	"resolve.ts": 1,
	"graph.ts": 1,
	"lexical/": 1,
	"index-store.ts": 2,
	"options.ts": 2,
	"locales.ts": 3,
	"writer.ts": 4,
	"run.ts": 5,
	"index.ts": 6,
	"cli/": 7,
};

const pathOf = (file: string): string => relative(here, file);

const layerOf = (file: string): number | undefined => {
	const path = pathOf(file);

	return LAYERS[path] ?? LAYERS[`${path.split("/")[0]!}/`];
};

const sourceFiles = readdirSync(here, { recursive: true, encoding: "utf8" })
	.filter((name) => /\.ts$/.test(name) && !name.includes(".spec."))
	.map((name) => resolve(here, name));

/*
 * Type-only imports are followed, unlike in the module boundary spec. That one
 * is about what reaches a bundle, where a type erases; this is about design,
 * where naming a higher layer's type is a dependency in the forbidden
 * direction all the same.
 */
const walked = new Map<string, Set<string>>();

// One walk records the direct imports of every file it reaches.
const importsOf = (file: string): string[] => {
	if (!walked.has(file)) {
		for (const [source, targets] of walkModuleGraph(file, {
			includeTypeImports: true,
		}).imports) {
			walked.set(source, targets);
		}
	}

	return [...(walked.get(file) ?? [])];
};

const forbiddenImports = (file: string, layer: number): string[] =>
	importsOf(file)
		.filter((target) => (layerOf(target) ?? 0) > layer)
		.map((target) => `${pathOf(file)} -> ${pathOf(target)}`);

describe("layer boundaries", () => {
	it("finds source files to check", () => {
		expect(sourceFiles).not.toEqual([]);
	});

	it("names only files and directories that exist", () => {
		expect(
			Object.keys(LAYERS).filter((path) => !existsSync(resolve(here, path))),
		).toEqual([]);
	});

	it("assigns every source file to a layer", () => {
		expect(
			sourceFiles.filter((file) => layerOf(file) === undefined).map(pathOf),
		).toEqual([]);
	});

	it("imports only the same or lower layers", () => {
		expect(
			sourceFiles.flatMap((file) => forbiddenImports(file, layerOf(file)!)),
		).toEqual([]);
	});

	/*
	 * Guards against the layer check passing because nothing was actually
	 * walked: the writer does reach the ref walk, and held to layer 0 that edge
	 * must be reported.
	 */
	it("sees a forbidden edge when one is introduced", () => {
		expect(forbiddenImports(resolve(here, "writer.ts"), 0)).toContain(
			"writer.ts -> resolve.ts",
		);
	});
});
