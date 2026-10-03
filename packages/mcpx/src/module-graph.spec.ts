import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { walkModuleGraph } from "../test/module-graph.js";

import type { WalkOptions } from "../test/module-graph.js";

// Tests test/module-graph.ts, kept in src/ where the unit runner collects specs.

/** The bare specifiers walked out of one file holding `lines`. */
const specifiersIn = (lines: string[], options?: WalkOptions): string[] => {
	const dir = mkdtempSync(join(tmpdir(), "mcpx-graph-"));
	const file = join(dir, "subject.ts");

	try {
		writeFileSync(file, `${lines.join("\n")}\n`);

		return [...walkModuleGraph(file, options).bareSpecifiers].sort();
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
};

describe("walkModuleGraph", () => {
	it("follows every import and re-export form", () => {
		expect(
			specifiersIn([
				'import a from "default";',
				'import b, { c } from "default-and-named";',
				'import * as d from "namespace";',
				"import {",
				"\te,",
				"\tf,",
				'} from "multi-line";',
				'import { /* g, */ h } from "commented";',
				'import { "kebab-name" as i } from "string-named";',
				'import "side-effect";',
				'export * from "star";',
				'export * as ns from "star-as";',
				'export { j } from "re-export";',
				'export const lazy = () => import("dynamic");',
				"export const used = [a, b, c, d, e, f, h, i];",
			]),
		).toEqual([
			"commented",
			"default",
			"default-and-named",
			"dynamic",
			"multi-line",
			"namespace",
			"re-export",
			"side-effect",
			"star",
			"star-as",
			"string-named",
		]);
	});

	it("leaves type-only imports and exports out unless asked to follow them", () => {
		const lines = [
			'import type { A } from "type-import";',
			'export type { B } from "type-export";',
			'import { type C } from "inline-type";',
			'import { d } from "value";',
			"export const used: [A, C] | typeof d = d;",
		];

		expect(specifiersIn(lines)).toEqual(["inline-type", "value"]);
		expect(specifiersIn(lines, { includeTypeImports: true })).toEqual([
			"inline-type",
			"type-export",
			"type-import",
			"value",
		]);
	});

	it("reads no specifier out of a type alias declaration", () => {
		expect(
			specifiersIn(
				[
					'import type { Payload } from "payload";',
					"export type Picked = Payload;",
					'export const hasFrom = (value: object): boolean => "from" in value;',
					'export const label = "x";',
				],
				{ includeTypeImports: true },
			),
		).toEqual(["payload"]);
	});
});
