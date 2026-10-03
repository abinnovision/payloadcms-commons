import { walkModuleGraph as walk } from "@internal/test-utils/module-graph";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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
