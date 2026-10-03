import { walkModuleGraph } from "@internal/test-utils/module-graph";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "index.ts");

describe("./admin module boundary", () => {
	/*
	 * This entrypoint is mounted through the admin import map and ships to the
	 * browser, so nothing server-side may be reachable as a value import.
	 */
	it("reaches no runtime import of payload", () => {
		const { bareSpecifiers } = walkModuleGraph(entry);

		for (const specifier of bareSpecifiers) {
			expect(specifier === "payload" || specifier.startsWith("payload/")).toBe(
				false,
			);
		}
	});

	it("reaches no node builtin", () => {
		const { bareSpecifiers } = walkModuleGraph(entry);

		for (const specifier of bareSpecifiers) {
			expect(specifier.startsWith("node:")).toBe(false);
		}
	});

	it("reaches neither zod nor the MCP SDK", () => {
		const { bareSpecifiers } = walkModuleGraph(entry);

		for (const specifier of bareSpecifiers) {
			expect(specifier === "zod" || specifier.startsWith("zod/")).toBe(false);
			expect(specifier.startsWith("@modelcontextprotocol/sdk")).toBe(false);
		}
	});

	it("actually walks the admin surface (sanity check against a vacuous pass)", () => {
		const { bareSpecifiers, files } = walkModuleGraph(entry);
		const names = [...files].map((file) => file.split("/").pop());

		expect(names).toContain("capability-matrix.tsx");
		expect(names).toContain("setup-guide.tsx");
		expect(names).toContain("capability-matrix.ts");
		expect(names).toContain("setup-guide.ts");
		expect([...bareSpecifiers]).toContain("react");
		expect([...bareSpecifiers]).toContain("@payloadcms/ui");
	});
});
