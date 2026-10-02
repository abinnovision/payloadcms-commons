import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { walkModuleGraph } from "../test/module-graph.js";

describe("walkModuleGraph", () => {
	it("reads no specifier out of a type alias declaration", () => {
		const dir = mkdtempSync(join(tmpdir(), "mcpx-graph-"));
		const file = join(dir, "alias.ts");

		try {
			writeFileSync(
				file,
				[
					'import type { Payload } from "payload";',
					"export type Picked = Payload;",
					'export const hasFrom = (value: object): boolean => "from" in value;',
					'export const label = "x";',
					"",
				].join("\n"),
			);

			const { bareSpecifiers } = walkModuleGraph(file, {
				includeTypeImports: true,
			});

			expect([...bareSpecifiers]).toEqual(["payload"]);
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
