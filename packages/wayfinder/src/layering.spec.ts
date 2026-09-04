import { readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { walkModuleGraph } from "../test/module-graph.js";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * The layering, as a directed allowlist.
 *
 * Each layer may reach the ones listed for it and nothing else, which is what
 * makes the claims in the README true rather than aspirational: the pattern
 * layer works with no Payload instance, and the runtime layer works with no
 * CMS global, because neither can name what would drag those in.
 */
const ALLOWED_EDGES: Record<string, string[]> = {
	pattern: [],
	runtime: ["pattern"],
	config: ["pattern", "runtime"],
	lexical: ["pattern", "runtime", "config"],
	admin: ["pattern", "runtime", "config"],
	montage: ["pattern", "runtime", "config"],
};

const LAYERS = Object.keys(ALLOWED_EDGES);

/** Which layer a file belongs to, or undefined for the root barrel. */
const layerOf = (file: string): string | undefined =>
	LAYERS.find((layer) => file.startsWith(`${resolve(here, layer)}/`));

const sourceFiles = (layer: string): string[] =>
	readdirSync(resolve(here, layer))
		.filter((name) => /\.tsx?$/.test(name) && !name.includes(".spec."))
		.map((name) => resolve(here, layer, name));

describe("layer boundaries", () => {
	/*
	 * Type-only imports are followed here, unlike in the per-entrypoint
	 * boundary specs. Those are about what reaches a consumer's bundle, where
	 * a type erases and cannot matter. This is about design: a lower layer
	 * naming a higher layer's type is a dependency in the forbidden direction
	 * whether or not it survives compilation, and the type declarations it
	 * emits carry the same coupling.
	 */
	const walk = (entry: string) =>
		walkModuleGraph(entry, { includeTypeImports: true });

	it.each(LAYERS)("%s reaches only its allowed layers", (layer) => {
		const allowed = new Set([layer, ...ALLOWED_EDGES[layer]!]);
		const reached = new Set<string>();

		for (const entry of sourceFiles(layer)) {
			for (const file of walk(entry).files) {
				const target = layerOf(file);

				if (target) {
					reached.add(target);
				}
			}
		}

		expect([...reached].filter((it) => !allowed.has(it))).toEqual([]);
	});

	it("keeps the pattern layer free of every other layer", () => {
		/*
		 * Called out separately because it is the load-bearing one: the link
		 * field's data types and the resolved-link shape live here precisely
		 * so the runtime can consume them without reaching up into config.
		 */
		for (const entry of sourceFiles("pattern")) {
			for (const file of walk(entry).files) {
				expect(layerOf(file) ?? "pattern").toBe("pattern");
			}
		}
	});

	it("sees a forbidden edge if one is introduced (sanity check)", () => {
		/*
		 * Guards against the assertion above passing because the walk found
		 * nothing. Walking a config file must reach the pattern layer, which
		 * proves cross-layer edges are visible to it at all.
		 */
		const reached = new Set<string>();

		for (const file of walk(resolve(here, "config", "mapping-global.ts"))
			.files) {
			const layer = layerOf(file);

			if (layer) {
				reached.add(layer);
			}
		}

		expect(reached).toContain("pattern");
	});

	it("covers every layer directory that exists", () => {
		/*
		 * A new directory under src/ would otherwise be silently unpoliced.
		 */
		const directories = readdirSync(here, { withFileTypes: true })
			.filter((it) => it.isDirectory())
			.map((it) => it.name);

		expect(directories.sort()).toEqual([...LAYERS].sort());
	});
});
