import { walkModuleGraph } from "@internal/test-utils/module-graph";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "index.ts");

/*
 * This entrypoint runs in the Flue sidecar beside ./agent and reaches only
 * its optional peers and the ./agent side of src/. Type-only imports are
 * followed too, since the published declarations must resolve there.
 */
const bareSpecifiersOf = (file: string): string[] => [
	...walkModuleGraph(file, { includeTypeImports: true }).bareSpecifiers,
];

describe("./pdf module boundary", () => {
	it("reaches only @flue/runtime, valibot and its peers", () => {
		expect(bareSpecifiersOf(entry).sort()).toEqual([
			"@flue/runtime",
			"@napi-rs/canvas",
			"unpdf",
			"valibot",
		]);
	});

	it("reaches only agent/ and protocol/ from the rest of src/", () => {
		const outside = [
			...walkModuleGraph(entry, { includeTypeImports: true }).files,
		]
			.map((file) => relative(resolve(here, ".."), file))
			.filter((file) => !file.startsWith("pdf/"));

		expect(
			outside.filter(
				(file) => !file.startsWith("agent/") && !file.startsWith("protocol/"),
			),
		).toEqual([]);
		expect(outside).toContain("agent/file-tools.ts");
	});

	it("walks the ./pdf surface", () => {
		const files = [...walkModuleGraph(entry).files].map((file) =>
			relative(resolve(here, ".."), file),
		);

		expect(files).toEqual(
			expect.arrayContaining(["pdf/cache.ts", "pdf/index.ts", "pdf/pdf.ts"]),
		);
	});
});
