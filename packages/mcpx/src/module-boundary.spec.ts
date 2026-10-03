import { walkModuleGraph } from "@internal/test-utils/module-graph";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "index.ts");

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

	it("actually walks the whole server surface (sanity check against a vacuous pass)", () => {
		const { bareSpecifiers, files } = walkModuleGraph(entry);
		const names = [...files].map((file) => file.split("/").pop());

		expect(names).toContain("plugin.ts");
		expect(names).toContain("handler.ts");
		expect(names).toContain("patch-document.ts");
		expect(names).toContain("collection.ts");
		expect([...bareSpecifiers]).toContain("payload");
	});
});
