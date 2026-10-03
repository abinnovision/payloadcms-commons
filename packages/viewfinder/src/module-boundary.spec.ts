import { walkModuleGraph } from "@internal/test-utils/module-graph";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

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
});
