import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { walkModuleGraph } from "../test/module-graph.js";

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "index.ts");

describe('the "." module boundary', () => {
	/*
	 * The plugin is imported from the server config, which the CLI loads
	 * without React or the admin UI. Both belong to `./client` alone.
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

	it("flags a disallowed value import", () => {
		const dir = mkdtempSync(join(tmpdir(), "mcpx-boundary-"));
		const file = join(dir, "bad.ts");

		try {
			writeFileSync(
				file,
				'import { useState } from "react";\nexport const x = useState;\n',
			);

			expect([...walkModuleGraph(file).bareSpecifiers]).toContain("react");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
