import { walkModuleGraph } from "@internal/test-utils/module-graph";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "index.ts");

describe('the "." module boundary', () => {
	/*
	 * The library surface runs inside the caller's process, which may be a Next
	 * route or a test. Reading argv, writing to stdout and choosing an exit code
	 * belong to `./cli` alone.
	 */
	it("reaches no process concerns", () => {
		const { bareSpecifiers, files } = walkModuleGraph(entry);

		expect([...bareSpecifiers]).not.toContain("node:process");
		expect([...bareSpecifiers]).not.toContain("node:util");

		for (const file of files) {
			expect(file.includes("/cli/")).toBe(false);
		}
	});

	it("reaches no .tsx file, so nothing renders", () => {
		for (const file of walkModuleGraph(entry).files) {
			expect(file.endsWith(".tsx")).toBe(false);
		}
	});

	it("reaches neither react nor @payloadcms/ui", () => {
		const { bareSpecifiers } = walkModuleGraph(entry);

		expect([...bareSpecifiers]).not.toContain("react");
		expect([...bareSpecifiers]).not.toContain("@payloadcms/ui");
	});

	it("actually walks the whole library (sanity check against a vacuous pass)", () => {
		const { bareSpecifiers, files } = walkModuleGraph(entry);
		const names = [...files].map((file) => file.split("/").pop());

		expect(names).toContain("run.ts");
		expect(names).toContain("writer.ts");
		expect(names).toContain("resolve.ts");
		expect(names).toContain("graph.ts");
		expect(names).toContain("locales.ts");
		expect([...bareSpecifiers]).toContain("payload");
	});
});

describe('the "./cli" module boundary', () => {
	const cliEntry = resolve(here, "cli", "index.ts");

	it("reaches the library, which is what it drives", () => {
		const names = [...walkModuleGraph(cliEntry).files].map((file) =>
			file.split("/").pop(),
		);

		expect(names).toContain("run.ts");
	});

	it("is the only surface that reads argv", () => {
		expect([...walkModuleGraph(cliEntry).bareSpecifiers]).toContain(
			"node:process",
		);
	});
});
