import { describe, expect, it } from "vitest";

import { fixtureConfig } from "../test/fixtures/config.js";

import type { FluePluginOptions } from "./types.js";
import type { Config, Payload } from "payload";

const SIDECAR_URL = "http://127.0.0.1:3101";

// The fixture after its plugin functions ran in order, as buildConfig runs them.
const applyPlugins = async (
	flue: Partial<FluePluginOptions>,
	extend: (config: Config) => Config = (config) => config,
): Promise<Config> => {
	let config = extend(fixtureConfig({ sidecarUrl: SIDECAR_URL, flue }));

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
		const config = await applyPlugins({ sidecar: SIDECAR }, (raw) => ({
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
		const config = await applyPlugins({ sidecar: SIDECAR });
		const own = config.collections?.filter((entry) =>
			["flue-threads", "mcpx-api-keys"].includes(entry.slug),
		);

		expect(own).toHaveLength(2);
		for (const entry of own ?? []) {
			expect(controlsOf(entry) ?? []).not.toContainEqual(BRIDGE);
		}
	});

	it("builds without the sidecar secret and fails at startup", async () => {
		const config = await applyPlugins({
			sidecar: { url: SIDECAR_URL, secret: "" },
		});

		await expect(config.onInit?.(payload)).rejects.toThrow(/sidecar\.secret/);
	});

	it("builds without the sidecar URL and fails at startup", async () => {
		const config = await applyPlugins({
			sidecar: { url: undefined as unknown as string, secret: "s".repeat(32) },
		});

		await expect(config.onInit?.(payload)).rejects.toThrow(/sidecar\.url/);
	});

	describe("files", () => {
		const filesOf = (config: Config) =>
			config.collections?.find((entry) => entry.slug === "flue-files");

		it("adds the files collection, which makes Payload check each file's content", async () => {
			const config = await applyPlugins({ sidecar: SIDECAR, files: true });

			expect(filesOf(config)?.upload).toMatchObject({
				mimeTypes: expect.arrayContaining(["application/pdf", "text/plain"]),
			});
		});

		it("leaves the files collection out by default", async () => {
			expect(filesOf(await applyPlugins({ sidecar: SIDECAR }))).toBeUndefined();
		});

		it("refuses an override that drops upload.mimeTypes", async () => {
			await expect(
				applyPlugins({
					sidecar: SIDECAR,
					files: {
						overrideCollection: (collection) => ({
							...collection,
							upload: { staticDir: "/tmp/files" },
						}),
					},
				}),
			).rejects.toThrow(/upload\.mimeTypes/);
		});

		it("refuses an override that allows uploads from a URL", async () => {
			await expect(
				applyPlugins({
					sidecar: SIDECAR,
					files: {
						overrideCollection: (collection) => ({
							...collection,
							upload: {
								...(collection.upload as object),
								pasteURL: { allowList: [] },
							},
						}),
					},
				}),
			).rejects.toThrow(/upload\.pasteURL/);
		});

		it("fails at startup when the upload config turns off Payload's access control", async () => {
			const config = await applyPlugins({ sidecar: SIDECAR, files: true });
			const collection = filesOf(config)!;
			const started = {
				collections: {
					"flue-files": {
						config: {
							...collection,
							upload: {
								...(collection.upload as object),
								disablePayloadAccessControl: true,
							},
						},
					},
				},
				logger: { warn: () => undefined },
			} as unknown as Payload;

			await expect(config.onInit?.(started)).rejects.toThrow(
				/disablePayloadAccessControl/,
			);
		});
	});
});
