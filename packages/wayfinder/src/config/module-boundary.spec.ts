import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { walkModuleGraph } from "../../test/module-graph.js";

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "index.ts");

const ALLOWED_DIRECTORIES = new Set([here, resolve(here, "..", "pattern")]);

describe("./config module boundary", () => {
	it("reaches only the pattern compiler and Payload's own validators", () => {
		/*
		 * `payload.config.ts` is loaded by the CLI, by migrations and by
		 * `generate:types`, none of which can start React. `payload/shared` is
		 * Payload's own field validators, which those processes already have.
		 */
		const { bareSpecifiers } = walkModuleGraph(entry);

		expect([...bareSpecifiers].sort()).toEqual([
			"path-to-regexp",
			"payload/shared",
		]);
	});

	it("actually walks into the field factories (sanity check)", () => {
		const { files } = walkModuleGraph(entry);
		const names = [...files].map((file) => file.split("/").pop());

		expect(names).toContain("link-field.ts");
		expect(names).toContain("mapping-global.ts");
		expect(names).toContain("plugin.ts");
	});

	it("never reaches a .tsx file, so no React enters the config graph", () => {
		for (const file of walkModuleGraph(entry).files) {
			expect(file.endsWith(".tsx")).toBe(false);
		}
	});

	it("never reaches the runtime, lexical, admin or montage surfaces", () => {
		for (const file of walkModuleGraph(entry).files) {
			expect(ALLOWED_DIRECTORIES).toContain(dirname(file));
		}
	});
});
