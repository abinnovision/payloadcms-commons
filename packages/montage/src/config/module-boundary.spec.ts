import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "index.ts");

const SPECIFIER_RE =
	/^\s*(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\bfrom\s+)?["']([^"']+)["']|^\s*import\s*\(\s*["']([^"']+)["']\s*\)/gm;
const TYPE_ONLY_RE = /^\s*(?:import|export)\s+type\b/;

const resolveRelative = (fromFile: string, specifier: string): string => {
	const base = resolve(dirname(fromFile), specifier);

	return base.endsWith(".js") ? `${base.slice(0, -3)}.ts` : `${base}.ts`;
};

interface Walk {
	files: Set<string>;
	bareSpecifiers: Set<string>;
}

/**
 * Walks the value-import graph reachable from `entryFile`. Type-only imports
 * and exports erase at compile time, so they are excluded: only they may
 * legally cross the `./config` boundary.
 */
const walk = (entryFile: string): Walk => {
	const files = new Set<string>();
	const bareSpecifiers = new Set<string>();
	const queue = [entryFile];

	while (queue.length > 0) {
		const file = queue.pop();
		if (!file || files.has(file)) {
			continue;
		}

		files.add(file);

		const source = readFileSync(file, "utf8");
		for (const line of source.split("\n")) {
			if (TYPE_ONLY_RE.test(line)) {
				continue;
			}

			SPECIFIER_RE.lastIndex = 0;
			let match: RegExpExecArray | null;
			while ((match = SPECIFIER_RE.exec(line))) {
				const specifier = match[1] ?? match[2];
				if (!specifier) {
					continue;
				}

				if (specifier.startsWith(".")) {
					queue.push(resolveRelative(file, specifier));
				} else {
					bareSpecifiers.add(specifier);
				}
			}
		}
	}

	return { files, bareSpecifiers };
};

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
