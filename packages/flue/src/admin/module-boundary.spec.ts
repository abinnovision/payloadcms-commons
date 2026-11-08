import { walkModuleGraph } from "@internal/test-utils/module-graph";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "index.ts");

const isPayload = (specifier: string): boolean =>
	specifier === "payload" || specifier.startsWith("payload/");

// The browser SDK is the only Flue package the admin may load.
const isSidecarDependency = (specifier: string): boolean =>
	(specifier.startsWith("@flue/") && specifier !== "@flue/sdk") ||
	specifier === "valibot" ||
	specifier.startsWith("valibot/");

const payloadValueImports = (file: string): string[] =>
	[...walkModuleGraph(file).bareSpecifiers].filter(isPayload);

describe("./admin module boundary", () => {
	/*
	 * This entrypoint is mounted through the admin import map and ships to the
	 * browser, so nothing server-side may be reachable as a value import.
	 */
	it("reaches no runtime import of payload", () => {
		expect(payloadValueImports(entry)).toEqual([]);
	});

	it("reaches no node builtin", () => {
		const { bareSpecifiers } = walkModuleGraph(entry);

		expect([...bareSpecifiers].filter((s) => s.startsWith("node:"))).toEqual(
			[],
		);
	});

	// Payload 4 wraps the router in @payloadcms/ui; the admin uses that.
	it("reaches no next module", () => {
		const { bareSpecifiers } = walkModuleGraph(entry);

		expect(
			[...bareSpecifiers].filter((s) => s === "next" || s.startsWith("next/")),
		).toEqual([]);
	});

	it("reaches no sidecar dependency, type-only imports included", () => {
		const { bareSpecifiers } = walkModuleGraph(entry, {
			includeTypeImports: true,
		});

		expect([...bareSpecifiers].filter(isSidecarDependency)).toEqual([]);
	});

	it("reaches only the bare specifiers it is allowed", () => {
		const { bareSpecifiers } = walkModuleGraph(entry, {
			includeTypeImports: true,
		});

		expect(
			[...bareSpecifiers].filter(
				(s) =>
					![
						"react",
						"@payloadcms/ui",
						"@assistant-ui/react",
						"@assistant-ui/react-markdown",
						"@flue/sdk",
					].includes(s),
			),
		).toEqual([]);
	});

	it("walks the admin surface", () => {
		const { bareSpecifiers, files } = walkModuleGraph(entry, {
			includeTypeImports: true,
		});
		const names = [...files].map((file) => file.split("/").pop());

		expect(names).toContain("index.ts");
		expect(names).toContain("panel.tsx");
		expect(names).toContain("conversation.ts");
		expect(names).toContain("context.ts");
		expect([...bareSpecifiers]).toContain("react");
		expect([...bareSpecifiers]).toContain("@payloadcms/ui");
		expect([...bareSpecifiers]).toContain("@assistant-ui/react");
		expect([...bareSpecifiers]).toContain("@flue/sdk");
		expect(payloadValueImports(resolve(here, "..", "index.ts"))).toContain(
			"payload",
		);
	});
});
