import { walkModuleGraph } from "@internal/test-utils/module-graph";
import { existsSync, readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The layering of the server entry, keyed by file or by directory (trailing
 * slash). A file may import its own layer and the ones below it.
 */
const LAYERS: Record<string, number> = {
	"protocol/": 0,
	"types.ts": 1,
	"options.ts": 1,
	"threads/": 2,
	"keys/": 2,
	"sidecar/": 2,
	"turn.ts": 3,
	"endpoints/": 4,
	"jobs/": 4,
	"plugin.ts": 5,
	"index.ts": 5,
};

/**
 * `./admin` and `./agent` run outside the Payload server, so they stand
 * outside the layering and may reach only protocol/ from the rest of src/.
 * The rule is written twice more: the `no-restricted-imports` rules in
 * eslint.config.ts and the module boundary specs. A change belongs in all
 * three.
 */
const OUTSIDE = ["admin/", "agent/"];
const OUTSIDE_MAY_IMPORT = ["protocol/"];

const pathOf = (file: string): string => relative(here, file);

const layerOf = (file: string): number | undefined => {
	const path = pathOf(file);

	return LAYERS[path] ?? LAYERS[`${path.split("/")[0]!}/`];
};

const outsideDirOf = (file: string): string | undefined =>
	OUTSIDE.find((dir) => pathOf(file).startsWith(dir));

const sourceFiles = readdirSync(here, { recursive: true, encoding: "utf8" })
	.filter((name) => /\.tsx?$/.test(name) && !name.includes(".spec."))
	.map((name) => resolve(here, name));

const serverFiles = sourceFiles.filter((file) => !outsideDirOf(file));
const outsideFiles = sourceFiles.filter((file) => outsideDirOf(file));

/*
 * Type-only imports are followed, unlike in the module boundary specs. Those
 * are about what reaches a bundle, where a type erases; this is about design,
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
		.filter(
			(target) =>
				outsideDirOf(target) !== undefined || (layerOf(target) ?? 0) > layer,
		)
		.map((target) => `${pathOf(file)} -> ${pathOf(target)}`);

const forbiddenOutsideImports = (
	file: string,
	allowed: string[] = OUTSIDE_MAY_IMPORT,
): string[] =>
	importsOf(file)
		.filter(
			(target) =>
				outsideDirOf(target) !== outsideDirOf(file) &&
				!allowed.some((prefix) => pathOf(target).startsWith(prefix)),
		)
		.map((target) => `${pathOf(file)} -> ${pathOf(target)}`);

describe("layer boundaries", () => {
	it("finds server, admin and agent files to check", () => {
		expect(serverFiles).not.toEqual([]);

		for (const dir of OUTSIDE) {
			expect(
				outsideFiles.filter((file) => outsideDirOf(file) === dir),
			).not.toEqual([]);
		}
	});

	it("names only files and directories that exist", () => {
		expect(
			[...Object.keys(LAYERS), ...OUTSIDE, ...OUTSIDE_MAY_IMPORT].filter(
				(path) => !existsSync(resolve(here, path)),
			),
		).toEqual([]);
	});

	it("assigns every server file to a layer", () => {
		expect(
			serverFiles.filter((file) => layerOf(file) === undefined).map(pathOf),
		).toEqual([]);
	});

	it("imports only the same or lower layers", () => {
		expect(
			serverFiles.flatMap((file) => forbiddenImports(file, layerOf(file)!)),
		).toEqual([]);
	});

	it("keeps admin and agent to protocol/", () => {
		expect(
			outsideFiles.flatMap((file) => forbiddenOutsideImports(file)),
		).toEqual([]);
	});

	it("keeps protocol/ free of bare specifiers", () => {
		expect(
			sourceFiles
				.filter((file) => layerOf(file) === 0)
				.flatMap((file) => [
					...walkModuleGraph(file, { includeTypeImports: true }).bareSpecifiers,
				]),
		).toEqual([]);
	});

	/*
	 * Guards against the layer check passing because type-only edges are
	 * invisible: options.ts reaches types.ts through `import type` alone,
	 * which must be flagged once the file is held to layer 0.
	 */
	it("sees a forbidden type-only edge", () => {
		const options = resolve(here, "options.ts");
		const valueImports = walkModuleGraph(options).imports.get(options);

		expect([...(valueImports ?? [])].map(pathOf)).not.toContain("types.ts");
		expect(forbiddenImports(options, 0)).toContain("options.ts -> types.ts");
	});

	it("sees an agent import outside the allowed list", () => {
		expect(
			forbiddenOutsideImports(resolve(here, "agent", "index.ts"), []),
		).toContain("agent/index.ts -> protocol/context.ts");
	});
});
