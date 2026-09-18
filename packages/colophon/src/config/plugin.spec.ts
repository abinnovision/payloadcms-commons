import { describe, expect, it } from "vitest";

import { COLOPHON_COMPONENT, COLOPHON_CUSTOM_KEY } from "../index.js";
import { colophonPlugin } from "./plugin.js";

import type { ColophonOptions } from "../index.js";
import type { Config } from "payload";

/**
 * The plugin only ever reads and rewrites `admin` and `custom`, so the
 * fixtures carry just those. `Config` itself additionally requires `db` and
 * `secret`, which have no bearing on what is under test.
 */
type TestConfig = Pick<Config, "admin" | "custom">;

const run = (
	config: TestConfig = {},
	args?: Parameters<typeof colophonPlugin>[0],
): TestConfig =>
	colophonPlugin(args)(config as unknown as Config) as unknown as TestConfig;

const mounted = (config: TestConfig): unknown[] =>
	(config.admin?.components?.afterNavLinks ?? []) as unknown[];

const parked = (config: TestConfig): ColophonOptions =>
	(config.custom as Record<string, ColophonOptions>)[
		COLOPHON_CUSTOM_KEY
	] as ColophonOptions;

describe("colophonPlugin", () => {
	it("mounts the component after the nav links", () => {
		expect(mounted(run())).toEqual([COLOPHON_COMPONENT]);
	});

	it("keeps components another plugin already put there", () => {
		const result = run({
			admin: { components: { afterNavLinks: ["some/other#Component"] } },
		});

		expect(mounted(result)).toEqual([
			"some/other#Component",
			COLOPHON_COMPONENT,
		]);
	});

	/*
	 * Applying twice happens when a project mounts the plugin and a preset it
	 * uses mounts it as well. Two copies of the group would render.
	 */
	it("mounts the component only once when applied twice", () => {
		expect(mounted(run(run()))).toEqual([COLOPHON_COMPONENT]);
	});

	it("leaves other admin components untouched", () => {
		const result = run({
			admin: { components: { graphics: { Logo: "some/logo#Logo" } } },
		});

		expect(result.admin?.components?.graphics).toEqual({
			Logo: "some/logo#Logo",
		});
	});

	it("parks the resolved options on the server-only custom key", () => {
		const options = parked(run());

		expect(options.items.map((it) => it.key)).toEqual([
			"version",
			"commit",
			"environment",
		]);
		expect(options.label).toBe("System");
		expect(options.open).toBe(false);
	});

	it("keeps custom data another plugin already parked", () => {
		const result = run({ custom: { other: true } });

		expect(result.custom?.["other"]).toBe(true);
		expect(result.custom?.[COLOPHON_CUSTOM_KEY]).toBeDefined();
	});

	it("replaces the default items when items are given", () => {
		const options = parked(
			run({}, { items: [{ key: "region", env: ["APP_REGION"] }] }),
		);

		expect(options.items.map((it) => it.key)).toEqual(["region"]);
	});

	it("carries the label, open state and condition through", () => {
		const condition = () => true;
		const options = parked(
			run({}, { label: { en: "Build" }, open: true, condition }),
		);

		expect(options.label).toEqual({ en: "Build" });
		expect(options.open).toBe(true);
		expect(options.condition).toBe(condition);
	});

	/*
	 * Validation runs where the plugin is built rather than where it is
	 * applied, so a bad config fails while the config file is being evaluated.
	 */
	it("rejects duplicate item keys before the config is even built", () => {
		expect(() =>
			colophonPlugin({ items: [{ key: "a" }, { key: "a" }] }),
		).toThrow(/Duplicate item key "a"/);
	});

	it("identifies itself to Payload", () => {
		expect(colophonPlugin().slug).toBe("colophon");
	});
});
