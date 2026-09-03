import { describe, expect, it } from "vitest";

import { montagePlugin } from "./plugin.js";

import type { Block, Config } from "payload";

const block = (slug: string): Block => ({ slug, fields: [] });

/**
 * `montagePlugin` only reads and spreads `config.blocks`; a full `Config`
 * (which requires `db`, `secret`, ...) is unnecessary machinery for that.
 */
const fakeConfig = (blocks?: Block[]): Config =>
	// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
	({ blocks }) as Config;

describe("montagePlugin", () => {
	it("appends to config.blocks and preserves existing entries", async () => {
		const existing = block("existing");
		const added = block("hero-module");
		const plugin = montagePlugin({ blocks: [added] });
		const config = fakeConfig([existing]);

		const result = await plugin(config);

		expect(result.blocks).toEqual([existing, added]);
	});

	it("works against a config with no prior blocks", async () => {
		const added = block("hero-module");
		const plugin = montagePlugin({ blocks: [added] });
		const config = fakeConfig();

		const result = await plugin(config);

		expect(result.blocks).toEqual([added]);
	});

	it("sets slug: montage", () => {
		const plugin = montagePlugin({ blocks: [] });
		expect(plugin.slug).toBe("montage");
	});
});
