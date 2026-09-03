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

	it("throws when montagePlugin is passed the same slug twice", () => {
		const plugin = montagePlugin({
			blocks: [block("hero-module"), block("hero-module")],
		});

		expect(() => plugin(fakeConfig())).toThrow(
			/duplicate block slug in config\.blocks: "hero-module" \(2 passed to montagePlugin\)/,
		);
	});

	it("throws when a slug collides with one already in config.blocks", () => {
		const plugin = montagePlugin({ blocks: [block("hero-module")] });
		const config = fakeConfig([block("hero-module")]);

		expect(() => plugin(config)).toThrow(
			/"hero-module" \(1 already in config.blocks, 1 passed to montagePlugin\)/,
		);
	});

	it("throws when the consumer's own config.blocks already has a duplicate", () => {
		const plugin = montagePlugin({ blocks: [] });
		const config = fakeConfig([block("existing"), block("existing")]);

		expect(() => plugin(config)).toThrow(
			/"existing" \(2 already in config.blocks\)/,
		);
	});

	it("names every duplicated slug, not just the first", () => {
		const plugin = montagePlugin({
			blocks: [block("a"), block("a"), block("b"), block("b")],
		});

		expect(() => plugin(fakeConfig())).toThrow(
			/duplicate block slugs in config.blocks: "a" \(2 passed to montagePlugin\); "b" \(2 passed to montagePlugin\)/,
		);
	});

	it("allows distinct slugs across both sides", async () => {
		const plugin = montagePlugin({ blocks: [block("hero-module")] });
		const config = fakeConfig([block("existing")]);

		const result = await plugin(config);

		expect(result.blocks?.map((b) => b.slug)).toEqual([
			"existing",
			"hero-module",
		]);
	});

	it("sets slug: montage", () => {
		const plugin = montagePlugin({ blocks: [] });
		expect(plugin.slug).toBe("montage");
	});
});
