import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { walkModuleGraph as walk } from "../../test/module-graph.js";

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "index.ts");

describe("./config module boundary", () => {
	it("reaches no bare specifier other than `payload`", () => {
		/*
		 * The strongest possible outcome is an empty set: `plugin.ts` only needs
		 * `import type { Block, Plugin } from "payload"`, which erases at compile
		 * time, so this asserts a subset rather than requiring "payload" to
		 * appear.
		 */
		const { bareSpecifiers } = walk(entry);
		for (const specifier of bareSpecifiers) {
			expect(specifier).toBe("payload");
		}
	});

	it("actually walks into plugin.ts (sanity check against a vacuous pass)", () => {
		const { files } = walk(entry);
		expect([...files].some((file) => file.endsWith("plugin.ts"))).toBe(true);
	});

	it("would flag a disallowed value import if one were introduced", () => {
		/*
		 * Proves the walk's own mechanism, since the real graph above has
		 * nothing to catch: a value import of a non-"payload" specifier is
		 * exactly what this spec exists to fail on. Written to a temp file
		 * rather than a fixture under src/, which would itself trip the
		 * eslint boundary rule and the module-graph walk it duplicates.
		 */
		const dir = mkdtempSync(join(tmpdir(), "montage-boundary-"));
		const file = join(dir, "bad.ts");
		try {
			writeFileSync(
				file,
				'import { useState } from "react";\nexport const x = useState;\n',
			);
			const { bareSpecifiers } = walk(file);
			expect([...bareSpecifiers]).toContain("react");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});

	it("never reaches a .tsx file (no React in the config graph)", () => {
		const { files } = walk(entry);
		for (const file of files) {
			expect(file.endsWith(".tsx")).toBe(false);
		}
	});

	it("never reaches a file outside src/config", () => {
		const { files } = walk(entry);
		for (const file of files) {
			expect(file.includes(resolve(here))).toBe(true);
		}
	});
});
