import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { walkModuleGraph } from "../../test/module-graph.js";

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "index.ts");

describe("./admin module boundary", () => {
	/*
	 * The admin surface may reach the admin bundle and nothing else. `react`
	 * is absent because the JSX runtime import is injected by the compiler
	 * rather than written in the source.
	 */
	it("reaches only the admin bundle", () => {
		expect([...walkModuleGraph(entry).bareSpecifiers].sort()).toEqual([
			"@payloadcms/ui",
		]);
	});

	it("actually walks into colophon.tsx (sanity check against a vacuous pass)", () => {
		const { files } = walkModuleGraph(entry);

		expect([...files].some((file) => file.endsWith("colophon.tsx"))).toBe(true);
	});

	/*
	 * The component reads `process.env` in the running process, which a client
	 * component cannot do. A stray directive anywhere in this graph would turn
	 * the runtime read into a build-time snapshot without failing anything else.
	 */
	it('carries no "use client" directive anywhere in its graph', () => {
		for (const file of walkModuleGraph(entry).files) {
			expect(readFileSync(file, "utf8")).not.toMatch(/^\s*["']use client["']/m);
		}
	});
});
