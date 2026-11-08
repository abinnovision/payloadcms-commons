import { walkModuleGraph } from "@internal/test-utils/module-graph";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "index.ts");

/*
 * This entrypoint runs in the Flue sidecar, which installs no Payload and no
 * React. Type-only imports are followed too: a type from payload in the
 * published declarations would fail to resolve there.
 */
const bareSpecifiersOf = (file: string): string[] => [
	...walkModuleGraph(file, { includeTypeImports: true }).bareSpecifiers,
];

describe("./agent module boundary", () => {
	it("reaches no payload, type-only imports included", () => {
		expect(
			bareSpecifiersOf(entry).filter(
				(s) => s === "payload" || s.startsWith("payload/"),
			),
		).toEqual([]);
	});

	it("reaches no @payloadcms/* package", () => {
		expect(
			bareSpecifiersOf(entry).filter((s) => s.startsWith("@payloadcms/")),
		).toEqual([]);
	});

	it("reaches no react", () => {
		expect(
			bareSpecifiersOf(entry).filter(
				(s) => s === "react" || s.startsWith("react/"),
			),
		).toEqual([]);
	});

	it("reaches no node builtin", () => {
		expect(
			bareSpecifiersOf(entry).filter((s) => s.startsWith("node:")),
		).toEqual([]);
	});

	it("reaches only @flue/runtime and valibot", () => {
		expect(bareSpecifiersOf(entry).sort()).toEqual([
			"@flue/runtime",
			"valibot",
		]);
	});

	it("walks the agent surface", () => {
		const files = [...walkModuleGraph(entry).files].map((file) =>
			relative(resolve(here, ".."), file),
		);

		expect(files).toEqual(
			expect.arrayContaining([
				"agent/context.ts",
				"agent/index.ts",
				"agent/exchange.ts",
				"agent/settled.ts",
				"agent/title.ts",
				"agent/upload.ts",
				"agent/use-payload.ts",
				"protocol/context.ts",
				"protocol/events.ts",
				"protocol/exchange.ts",
				"protocol/paths.ts",
			]),
		);
		// types.ts imports payload through `import type` alone.
		const types = resolve(here, "..", "types.ts");

		expect([...walkModuleGraph(types).bareSpecifiers]).not.toContain("payload");
		expect(bareSpecifiersOf(types)).toContain("payload");
	});
});
