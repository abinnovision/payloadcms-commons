import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { walkModuleGraph } from "../test/module-graph.js";

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "index.ts");

describe('the "." module boundary', () => {
	it("reaches no bare specifier at all", () => {
		/*
		 * The addressing layer is shared by the frontend bundle and the admin
		 * bundle. It is pure string and object work, so the honest assertion is
		 * that it imports nothing: no React, no Payload runtime, no Next.
		 */
		const { bareSpecifiers } = walkModuleGraph(entry);
		expect([...bareSpecifiers]).toEqual([]);
	});

	it("actually walks the whole core (sanity check against a vacuous pass)", () => {
		const { files } = walkModuleGraph(entry);
		const names = [...files].map((file) => file.split("/").pop());
		expect(names).toContain("protocol.ts");
		expect(names).toContain("resolve-path.ts");
		expect(names).toContain("attributes.ts");
	});

	it("never reaches the client, admin or config surfaces", () => {
		const { files } = walkModuleGraph(entry);
		for (const file of files) {
			expect(dirname(file)).toBe(here);
		}
	});

	it("would flag a disallowed value import if one were introduced", () => {
		/*
		 * Proves the walk's own mechanism, since the real graph has nothing to
		 * catch. Written to a temp file rather than a fixture under src/, which
		 * would itself trip the eslint boundary rule this duplicates.
		 */
		const dir = mkdtempSync(join(tmpdir(), "viewfinder-boundary-"));
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

	it("sees a re-export that spans several lines", () => {
		/*
		 * Regression guard. A per-line scan misses `export {\n a,\n} from "x"`,
		 * which silently drops that module and everything under it from the
		 * graph — turning every assertion above into a vacuous pass.
		 */
		const dir = mkdtempSync(join(tmpdir(), "viewfinder-boundary-"));
		const file = join(dir, "multiline.ts");
		try {
			writeFileSync(
				file,
				'export {\n\tuseState,\n\tuseEffect,\n} from "react";\nexport type { Foo } from "payload";\n',
			);
			const { bareSpecifiers } = walkModuleGraph(file);
			expect([...bareSpecifiers]).toContain("react");
			expect([...bareSpecifiers]).not.toContain("payload");
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
