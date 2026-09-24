import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { walkModuleGraph } from "../../test/module-graph.js";

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "index.ts");

describe("./admin module boundary", () => {
	/*
	 * Notably not `payload` itself: the server package has no business in the
	 * admin bundle, and the shared layer this imports from `.` is free of it.
	 */
	it("reaches only React and the admin UI package", () => {
		expect([...walkModuleGraph(entry).bareSpecifiers].sort()).toEqual([
			"@payloadcms/ui",
			"@payloadcms/ui/shared",
			"react",
		]);
	});

	it("actually walks into tags-field.tsx and the shared layer", () => {
		const names = [...walkModuleGraph(entry).files].map((file) =>
			file.split("/").pop(),
		);

		expect(names).toContain("tags-field.tsx");
		expect(names).toContain("selection.ts");
	});

	it("never reaches the config graph", () => {
		for (const file of walkModuleGraph(entry).files) {
			expect(file).not.toContain("/config/");
		}
	});

	/* Every component module is rendered in the browser by the admin bundle. */
	it('marks every admin module "use client"', () => {
		const adminFiles = [...walkModuleGraph(entry).files].filter((file) =>
			file.startsWith(here),
		);

		for (const file of adminFiles) {
			expect(readFileSync(file, "utf8")).toMatch(/^"use client";/);
		}
	});
});
