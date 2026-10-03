import { walkModuleGraph } from "@internal/test-utils/module-graph";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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
});
