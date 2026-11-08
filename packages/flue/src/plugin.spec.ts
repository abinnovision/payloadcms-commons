import { describe, expect, it } from "vitest";

import { fixtureConfig } from "../test/fixtures/config.js";

import type { FluePluginOptions } from "./types.js";
import type { Config, Payload } from "payload";

const SIDECAR_URL = "http://127.0.0.1:3101";

// The fixture after its plugin functions ran in order, as buildConfig runs them.
const applyPlugins = async (
	sidecar: FluePluginOptions["sidecar"],
): Promise<Config> => {
	let config = fixtureConfig({ sidecarUrl: SIDECAR_URL, flue: { sidecar } });

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

describe("fluePlugin", () => {
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
