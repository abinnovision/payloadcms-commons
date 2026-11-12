import { describe, expect, it } from "vitest";

import { fixtureConfig } from "../test/fixtures/config.js";

import type { FluePluginOptions } from "./types.js";
import type { Config, Payload } from "payload";

const SIDECAR_URL = "http://127.0.0.1:3101";

// The fixture after its plugin functions ran in order, as buildConfig runs them.
const applyPlugins = async (
	sidecar: FluePluginOptions["sidecar"],
	extend: (config: Config) => Config = (config) => config,
): Promise<Config> => {
	let config = extend(
		fixtureConfig({ sidecarUrl: SIDECAR_URL, flue: { sidecar } }),
	);

	for (const plugin of config.plugins ?? []) {
		// eslint-disable-next-line no-await-in-loop
		config = await plugin(config);
	}

	return config;
};

/*
 * flue's onInit fails before it reaches Payload. A complete sidecar
 * starting is what every integration boot shows.
 */
const payload = {} as unknown as Payload;

const SIDECAR = { url: SIDECAR_URL, secret: "s".repeat(32) };
const BRIDGE = {
	path: "@abinnovision/payloadcms-flue/admin",
	exportName: "FlueDocumentBridge",
};

const controlsOf = (entity?: {
	admin?: { components?: { edit?: { beforeDocumentControls?: unknown } } };
}): unknown => entity?.admin?.components?.edit?.beforeDocumentControls;

describe("fluePlugin", () => {
	it("mounts the document bridge in the edit view of every content entity", async () => {
		const config = await applyPlugins(SIDECAR, (raw) => ({
			...raw,
			globals: [
				{
					slug: "settings",
					admin: {
						components: { edit: { beforeDocumentControls: ["./Own"] } },
					},
					fields: [],
				},
			],
		}));
		const collection = (slug: string) =>
			config.collections?.find((entry) => entry.slug === slug);

		expect(controlsOf(collection("pages"))).toEqual([BRIDGE]);
		expect(controlsOf(collection("users"))).toEqual([BRIDGE]);
		expect(controlsOf(config.globals?.[0])).toEqual(["./Own", BRIDGE]);
	});

	it("leaves the bridge out of the threads and mcpx key collections", async () => {
		const config = await applyPlugins(SIDECAR);
		const own = config.collections?.filter((entry) =>
			["flue-threads", "mcpx-api-keys"].includes(entry.slug),
		);

		expect(own).toHaveLength(2);
		for (const entry of own ?? []) {
			expect(controlsOf(entry) ?? []).not.toContainEqual(BRIDGE);
		}
	});

	it("builds without the sidecar secret and fails at startup", async () => {
		const config = await applyPlugins({ url: SIDECAR_URL, secret: "" });

		await expect(config.onInit?.(payload)).rejects.toThrow(/sidecar\.secret/);
	});

	it("builds without the sidecar URL and fails at startup", async () => {
		const config = await applyPlugins({
			url: undefined as unknown as string,
			secret: "s".repeat(32),
		});

		await expect(config.onInit?.(payload)).rejects.toThrow(/sidecar\.url/);
	});
});
