import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const SPECIFIER_RE =
	/(?:^|\n)\s*(?:import|export)\b(?:[\s\S]*?\bfrom\s*)?["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;
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

export interface ModuleGraph {
	files: Set<string>;
	bareSpecifiers: Set<string>;
}

export interface WalkOptions {
	/**
	 * Follow `import type` as well.
	 *
	 * Off by default, because a type-only import erases and therefore cannot
	 * affect a consumer's bundle — which is what the per-entrypoint boundary
	 * assertions are about. The layering assertions are about design rather
	 * than bundling: a lower layer naming a higher layer's type is still a
	 * dependency in the direction the layering forbids, and leaving it
	 * invisible would let that assertion pass vacuously.
	 */
	includeTypeImports?: boolean;
}

/**
 * Walks the value-import graph reachable from `entryFile`. Type-only imports
 * and exports erase at compile time, so they are excluded: only they may
 * legally cross an entrypoint boundary.
 *
 * This duplicates what the eslint `no-restricted-imports` patterns express,
 * on purpose. The lint rule constrains one file at a time; this constrains
 * everything an entrypoint transitively pulls in, which is the property that
 * actually matters to a consumer's bundler.
 */
export const walkModuleGraph = (
	entryFile: string,
	options: WalkOptions = {},
): ModuleGraph => {
	const files = new Set<string>();
	const bareSpecifiers = new Set<string>();
	const queue = [entryFile];

	while (queue.length > 0) {
		const file = queue.pop();
		if (!file || files.has(file)) {
			continue;
		}

		files.add(file);

		/*
		 * Scanned over the whole source rather than line by line: a re-export
		 * spanning several lines (`export {\n a,\n b,\n} from "./x.js"`) is
		 * invisible to a per-line regex, which would drop that file from the
		 * graph and let the boundary assertions pass vacuously.
		 */
		const source = readFileSync(file, "utf8");
		SPECIFIER_RE.lastIndex = 0;
		let match: RegExpExecArray | null;
		while ((match = SPECIFIER_RE.exec(source))) {
			if (!options.includeTypeImports && TYPE_ONLY_RE.test(match[0])) {
				continue;
			}

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

	return { files, bareSpecifiers };
};
