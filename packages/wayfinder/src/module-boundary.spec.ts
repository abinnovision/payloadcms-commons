import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { walkModuleGraph } from "../test/module-graph.js";

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "index.ts");

/**
 * Where the `.` surface may reach. The pattern layer compiles URL patterns
 * and the runtime layer queries through an injected Payload instance, so both
 * back this entrypoint.
 */
const ALLOWED_DIRECTORIES = new Set([
	here,
	resolve(here, "pattern"),
	resolve(here, "runtime"),
]);

describe('the "." module boundary', () => {
	it("reaches only the pattern compiler", () => {
		/*
		 * An allowlist rather than an empty set: compiling a route pattern is
		 * the one thing this surface cannot do for itself. Payload arrives as
		 * an injected instance, so it stays a type-only import and does not
		 * appear here — that is the property worth guarding, because it is
		 * what lets the runtime run outside a Payload process.
		 */
		const { bareSpecifiers } = walkModuleGraph(entry);

		expect([...bareSpecifiers].sort()).toEqual(["path-to-regexp"]);
	});

	/*
	 * `./internal` carries no compatibility guarantee, but it must carry the
	 * same runtime one: it is the same functions the router closes over, so a
	 * dependency reachable through it would be reachable through `.` too.
	 */
	it("holds the unbound functions to the same bundle guarantee", () => {
		const { bareSpecifiers } = walkModuleGraph(resolve(here, "internal.ts"));

		expect([...bareSpecifiers].sort()).toEqual(["path-to-regexp"]);
	});

	it("actually walks the whole core (sanity check against a vacuous pass)", () => {
		const { files } = walkModuleGraph(entry);
		const names = [...files].map((file) => file.split("/").pop());

		expect(names).toContain("resolver.ts");
		expect(names).toContain("matcher.ts");
		expect(names).toContain("resolve-path.ts");
		expect(names).toContain("build-href.ts");
	});

	it("never reaches the config, lexical, admin or montage surfaces", () => {
		const { files } = walkModuleGraph(entry);

		for (const file of files) {
			expect(ALLOWED_DIRECTORIES).toContain(dirname(file));
		}
	});

	it("would flag a disallowed value import if one were introduced", () => {
		/*
		 * Proves the walk's own mechanism, since the real graph has nothing to
		 * catch. Written to a temp file rather than a fixture under src/,
		 * which would itself trip the eslint boundary rule this duplicates.
		 */
		const dir = mkdtempSync(join(tmpdir(), "wayfinder-boundary-"));
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
		const dir = mkdtempSync(join(tmpdir(), "wayfinder-boundary-"));
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
