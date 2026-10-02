import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { walkModuleGraph } from "../test/module-graph.js";

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "index.ts");

describe("`.` module boundary", () => {
	/*
	 * This layer is reached from the config graph, which the CLI loads without
	 * React, and from the admin bundle. Anything it imports for real would be
	 * forced on both.
	 */
	it("reaches no bare specifier at all", () => {
		expect([...walkModuleGraph(entry).bareSpecifiers]).toEqual([]);
	});

	it("actually walks into color.ts (sanity check against a vacuous pass)", () => {
		const { files } = walkModuleGraph(entry);

		expect([...files].some((file) => file.endsWith("color.ts"))).toBe(true);
	});

	it("never reaches a .tsx file, so no React enters the shared layer", () => {
		for (const file of walkModuleGraph(entry).files) {
			expect(file.endsWith(".tsx")).toBe(false);
		}
	});
});
