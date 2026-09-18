import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { walkModuleGraph } from "../../test/module-graph.js";

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "index.ts");

describe("./config module boundary", () => {
	/*
	 * `payload.config.ts` is loaded by the CLI, by migrations and by
	 * `generate:types`. The plugin needs only `import type` from payload,
	 * which erases, so the honest assertion is that nothing survives.
	 */
	it("reaches no bare specifier at all", () => {
		expect([...walkModuleGraph(entry).bareSpecifiers]).toEqual([]);
	});

	it("actually walks into plugin.ts (sanity check against a vacuous pass)", () => {
		const { files } = walkModuleGraph(entry);

		expect([...files].some((file) => file.endsWith("plugin.ts"))).toBe(true);
	});

	it("never reaches a .tsx file, so no React enters the config graph", () => {
		for (const file of walkModuleGraph(entry).files) {
			expect(file.endsWith(".tsx")).toBe(false);
		}
	});
});
