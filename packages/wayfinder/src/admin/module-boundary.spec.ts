import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { walkModuleGraph } from "../../test/module-graph.js";

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, "index.ts");

describe("./admin module boundary", () => {
	it("reaches the editor runtime and nothing wider", () => {
		const { bareSpecifiers } = walkModuleGraph(entry);

		expect([...bareSpecifiers].sort()).toEqual([
			"@lexical/react/LexicalComposerContext",
			"@payloadcms/richtext-lexical/client",
			"lexical",
			"react",
		]);
	});

	it("never pulls in Payload's server surface", () => {
		/*
		 * This entrypoint is mounted through the admin import map and ships to
		 * the browser. `payload` and `payload/shared` are server code.
		 */
		const { bareSpecifiers } = walkModuleGraph(entry);

		expect([...bareSpecifiers]).not.toContain("payload");
		expect([...bareSpecifiers]).not.toContain("payload/shared");
	});

	it("reaches the label derivation it shares with the editor feature", () => {
		const { files } = walkModuleGraph(entry);
		const names = [...files].map((file) => file.split("/").pop());

		expect(names).toContain("derive-link-label.ts");
		expect(names).not.toContain("resolve-path.ts");
	});

	it("stays within the admin surface and the pattern layer", () => {
		const allowed = new Set([here, resolve(here, "..", "pattern")]);

		for (const file of walkModuleGraph(entry).files) {
			expect(allowed).toContain(dirname(file));
		}
	});
});
