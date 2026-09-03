import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "index.ts");

const SPECIFIER_RE =
	/^\s*(?:import|export)\s+(?:type\s+)?(?:[\s\S]*?\bfrom\s+)?["']([^"']+)["']|^\s*import\s*\(\s*["']([^"']+)["']\s*\)/gm;
const TYPE_ONLY_RE = /^\s*(?:import|export)\s+type\b/;

const resolveRelative = (fromFile: string, specifier: string): string => {
	const base = resolve(dirname(fromFile), specifier);
	const withExt = base.endsWith(".js")
		? `${base.slice(0, -3)}.ts`
		: `${base}.ts`;
	try {
		readFileSync(withExt, "utf8");

		return withExt;
	} catch {
		return withExt.replace(/\.ts$/, ".tsx");
	}
};

/** Walks the value-import graph reachable from `entryFile`, ignoring type-only imports. */
const walk = (entryFile: string): { bareSpecifiers: Set<string> } => {
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

	return { bareSpecifiers };
};

describe('the "." graph takes no dependency on Next', () => {
	it("reaches no `next` or `next/*` specifier", () => {
		const { bareSpecifiers } = walk(entry);
		for (const specifier of bareSpecifiers) {
			expect(specifier === "next" || specifier.startsWith("next/")).toBe(false);
		}
	});
});
