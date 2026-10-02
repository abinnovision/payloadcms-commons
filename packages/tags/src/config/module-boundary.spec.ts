import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { walkModuleGraph } from "../../test/module-graph.js";

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "index.ts");

describe("./config module boundary", () => {
	/*
	 * `payload.config.ts` is loaded by the CLI, by migrations and by
	 * `generate:types`. `payload` itself is a real dependency (`ValidationError`,
	 * `req.payload.find`), but React and the admin bundle are not.
	 */
	it("reaches only the payload runtime, never react or @payloadcms/ui", () => {
		expect([...walkModuleGraph(entry).bareSpecifiers].sort()).toEqual([
			"payload",
		]);
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
