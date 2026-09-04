import { describe, expect, it } from "vitest";

import { viewfinderPlugin } from "./plugin.js";

import type { CollectionConfig, Config, GlobalConfig } from "payload";

const BRIDGE = "@abinnovision/payloadcms-viewfinder/admin#ViewfinderFormBridge";

/**
 * The plugin only ever reads and rewrites `collections` and `globals`, so the
 * fixtures carry just those. `Config` itself additionally requires `db` and
 * `secret`, which have no bearing on what is under test.
 */
type TestConfig = Pick<Config, "collections" | "globals">;

const configOf = (
	collections: CollectionConfig[],
	globals: GlobalConfig[] = [],
): TestConfig => ({ collections, globals });

const run = (
	config: TestConfig,
	args?: Parameters<typeof viewfinderPlugin>[0],
): TestConfig =>
	viewfinderPlugin(args)(config as unknown as Config) as unknown as TestConfig;

const controls = (collection: CollectionConfig | undefined): unknown[] =>
	(collection?.admin?.components?.edit?.beforeDocumentControls ??
		[]) as unknown[];

describe("viewfinderPlugin", () => {
	it("mounts the bridge on every collection by default", () => {
		const result = run(
			configOf([
				{ slug: "pages", fields: [] },
				{ slug: "posts", fields: [] },
			]),
		);

		expect(controls(result.collections?.[0])).toEqual([BRIDGE]);
		expect(controls(result.collections?.[1])).toEqual([BRIDGE]);
	});

	it("mounts the bridge on globals, which nest the slot differently", () => {
		const result = run(configOf([], [{ slug: "settings", fields: [] }]));

		expect(
			result.globals?.[0]?.admin?.components?.elements?.beforeDocumentControls,
		).toEqual([BRIDGE]);
	});

	it("limits itself to the named collections", () => {
		const limited = run(
			configOf([
				{ slug: "pages", fields: [] },
				{ slug: "media", fields: [] },
			]),
			{ collections: ["pages"] },
		);

		expect(controls(limited.collections?.[0])).toEqual([BRIDGE]);
		expect(controls(limited.collections?.[1])).toEqual([]);
	});

	it("preserves components a consumer already registered", () => {
		const result = run(
			configOf([
				{
					slug: "pages",
					fields: [],
					admin: {
						components: {
							edit: { beforeDocumentControls: ["/components/Mine"] },
						},
					},
				},
			]),
		);

		expect(controls(result.collections?.[0])).toEqual([
			"/components/Mine",
			BRIDGE,
		]);
	});

	it("is idempotent, so applying it twice mounts one bridge", () => {
		const once = run(configOf([{ slug: "pages", fields: [] }]));
		const twice = run(once);

		expect(controls(twice.collections?.[0])).toEqual([BRIDGE]);
	});

	it("tolerates a config with no collections or globals", () => {
		const result = run({});

		expect(result.collections).toEqual([]);
		expect(result.globals).toEqual([]);
	});
});
