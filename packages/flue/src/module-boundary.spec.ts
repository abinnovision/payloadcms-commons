import { walkModuleGraph } from "@internal/test-utils/module-graph";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "index.ts");

const isSidecarDependency = (specifier: string): boolean =>
	specifier.startsWith("@flue/") ||
	specifier === "valibot" ||
	specifier.startsWith("valibot/");

describe('the "." module boundary', () => {
	/*
	 * The plugin is imported from the server config, which the CLI loads
	 * without React or the admin UI. Both belong to `./admin` alone.
	 */
	it("reaches no .tsx file", () => {
		for (const file of walkModuleGraph(entry).files) {
			expect(file.endsWith(".tsx")).toBe(false);
		}
	});

	it("reaches neither react nor @payloadcms/ui", () => {
		const { bareSpecifiers } = walkModuleGraph(entry);

		expect([...bareSpecifiers]).not.toContain("react");
		expect([...bareSpecifiers]).not.toContain("@payloadcms/ui");
	});

	/*
	 * A Payload project does not install the sidecar's dependencies, so not
	 * even a type from them may reach the published declarations.
	 */
	it("reaches neither @flue/* nor valibot, type-only imports included", () => {
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
				(s) => !["payload", "node:crypto", "eventsource-parser"].includes(s),
			),
		).toEqual([]);
	});

	it("walks the server surface", () => {
		const values = walkModuleGraph(entry);
		const withTypes = walkModuleGraph(entry, { includeTypeImports: true });
		const names = (files: Set<string>) =>
			[...files].map((file) => file.split("/").pop());

		expect(names(values.files)).toContain("plugin.ts");
		expect(names(values.files)).toContain("options.ts");
		expect([...values.bareSpecifiers]).toContain("payload");
		expect(names(withTypes.files)).toContain("types.ts");
		expect(names(withTypes.files)).toContain("context.ts");
	});
});
