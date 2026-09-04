import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { walkModuleGraph } from "../../test/module-graph.js";

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "index.ts");

/** Everything the admin bundle is allowed to pull in at runtime. */
const ALLOWED = new Set(["react", "@payloadcms/ui"]);

describe("./admin module boundary", () => {
	it("reaches nothing beyond React and the admin UI package", () => {
		/*
		 * Notably not `payload` itself: the server package has no business in
		 * the admin bundle, and the addressing layer this imports from `.` is
		 * deliberately free of it.
		 */
		for (const specifier of walkModuleGraph(entry).bareSpecifiers) {
			expect(ALLOWED).toContain(specifier);
		}
	});

	it("actually walks into the shared addressing layer", () => {
		const names = [...walkModuleGraph(entry).files].map((file) =>
			file.split("/").pop(),
		);
		expect(names).toContain("bridge.tsx");
		expect(names).toContain("resolve-path.ts");
	});
});
