import { walkModuleGraph } from "@internal/test-utils/module-graph";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "index.ts");

describe('the "." graph takes no dependency on Next', () => {
	it("reaches no `next` or `next/*` specifier", () => {
		const { bareSpecifiers } = walkModuleGraph(entry);
		for (const specifier of bareSpecifiers) {
			expect(specifier === "next" || specifier.startsWith("next/")).toBe(false);
		}
	});

	it("actually walks the renderer (sanity check against a vacuous pass)", () => {
		/*
		 * `index.ts` re-exports across several lines, which an earlier per-line
		 * walk could not follow — it saw only the entry file and passed
		 * vacuously.
		 */
		const names = [...walkModuleGraph(entry).files].map((file) =>
			file.split("/").pop(),
		);
		expect(names).toContain("block-tree.tsx");
		expect(names).toContain("context.ts");
		expect(names).toContain("registry.ts");
	});
});
