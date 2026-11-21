import { describe, expect, it } from "vitest";

import { fluePrivateUploads } from "./files/factory.js";
import { fixtureConfig } from "../test/fixtures/config.js";

import type { FluePluginOptions } from "./types.js";
import type { CollectionConfig, Config, Payload } from "payload";

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

	describe("admin", () => {
		const withSettings = (raw: Config): Config => ({
			...raw,
			globals: [{ slug: "settings", fields: [] }],
		});
		const componentsOf = (config: Config) => ({
			providers: config.admin?.components?.providers ?? [],
			actions: config.admin?.components?.actions ?? [],
		});
		const bridged = (config: Config): string[] =>
			[...(config.collections ?? []), ...(config.globals ?? [])]
				.filter((entity) =>
					((controlsOf(entity) as unknown[] | undefined) ?? []).some(
						(control) =>
							typeof control === "object" &&
							control !== null &&
							"exportName" in control &&
							control.exportName === BRIDGE.exportName,
					),
				)
				.map((entity) => entity.slug);

		it("mounts the chat by default", async () => {
			const config = await applyPlugins({ sidecar: SIDECAR });

			expect(componentsOf(config).providers).toContainEqual(
				expect.objectContaining({ exportName: "FlueProvider" }),
			);
			expect(componentsOf(config).actions).toContainEqual(
				expect.objectContaining({ exportName: "FlueToggle" }),
			);
		});

		it("mounts neither the chat nor the bridge with admin false", async () => {
			const config = await applyPlugins(
				{ sidecar: SIDECAR, admin: false },
				withSettings,
			);

			expect(componentsOf(config)).toEqual({ providers: [], actions: [] });
			expect(bridged(config)).toEqual([]);
		});

		it("keeps the chat and mounts no bridge with documentBridge false", async () => {
			const config = await applyPlugins(
				{ sidecar: SIDECAR, admin: { documentBridge: false } },
				withSettings,
			);

			expect(componentsOf(config).providers).toHaveLength(1);
			expect(bridged(config)).toEqual([]);
		});

		it("mounts the bridge on the listed slugs only", async () => {
			const config = await applyPlugins(
				{
					sidecar: SIDECAR,
					admin: {
						documentBridge: { collections: ["pages"], globals: ["settings"] },
					},
				},
				withSettings,
			);

			expect(bridged(config)).toEqual(["pages", "settings"]);
		});
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
		const UPLOADS: CollectionConfig = {
			slug: "uploads",
			upload: { mimeTypes: ["application/pdf"], pasteURL: false },
			fields: [{ name: "alt", type: "text" }],
		};

		const withUploads =
			(
				uploads: CollectionConfig = UPLOADS,
				baseAccess?: Config["baseAccess"],
			) =>
			(config: Config): Config => ({
				...config,
				collections: [...(config.collections ?? []), uploads],
				...(baseAccess ? { baseAccess } : {}),
			});

		const build = (
			uploads?: CollectionConfig,
			baseAccess?: Config["baseAccess"],
		) =>
			applyPlugins(
				{ sidecar: SIDECAR, files: { collection: "uploads" } },
				withUploads(uploads, baseAccess),
			);

		const uploadsOf = (config: Config) =>
			config.collections?.find((entry) => entry.slug === "uploads");

		it("adds the server-only thread field and the agent upload hook", async () => {
			const uploads = uploadsOf(await build());
			const field = uploads?.fields.find(
				(entry) => "name" in entry && entry.name === "flueThread",
			);

			expect(field).toMatchObject({
				type: "relationship",
				relationTo: "flue-threads",
				index: true,
			});
			expect(uploads?.hooks?.beforeChange).toHaveLength(1);
		});

		it("guards reads, updates and deletes through baseAccess and keeps an existing function", async () => {
			const existing = () => false;
			const config = await build(undefined, {
				collections: { read: existing },
			});
			const read = config.baseAccess?.collections?.read;
			const args = { req: {}, slug: "pages" } as unknown as Parameters<
				NonNullable<typeof read>
			>[0];

			expect(read).not.toBe(existing);
			expect(config.baseAccess?.collections).toEqual({
				read: expect.any(Function),
				readVersions: expect.any(Function),
				update: expect.any(Function),
				delete: expect.any(Function),
			});
			await expect(read?.(args)).resolves.toBe(false);
		});

		it("leaves baseAccess alone without files", async () => {
			expect(
				(await applyPlugins({ sidecar: SIDECAR })).baseAccess,
			).toBeUndefined();
		});

		it.each([
			[
				"a field named flueThread",
				{ ...UPLOADS, fields: [{ name: "flueThread", type: "text" }] },
				/already has a field named "flueThread"/,
			],
			[
				"a top-level download field",
				{ ...UPLOADS, fields: [{ name: "download", type: "text" }] },
				/field named "download"/,
			],
			[
				"no upload config",
				{ slug: "uploads", fields: [] },
				/must be an upload collection/,
			],
			[
				"no mimeTypes",
				{ ...UPLOADS, upload: { pasteURL: false } },
				/upload\.mimeTypes/,
			],
			[
				"authorship turned off",
				{ ...UPLOADS, authorship: false },
				/authorship\.createdBy/,
			],
			[
				"createdBy turned off",
				{ ...UPLOADS, authorship: { createdBy: false } },
				/authorship\.createdBy/,
			],
		] as [string, CollectionConfig, RegExp][])(
			"refuses a collection with %s",
			async (_label, uploads, message) => {
				await expect(build(uploads)).rejects.toThrow(message);
			},
		);

		it("refuses a fluePrivateUploads collection built for another user collection", async () => {
			await expect(
				build(
					fluePrivateUploads({
						slug: "uploads",
						mimeTypes: ["application/pdf"],
						userCollection: "admins",
					}),
				),
			).rejects.toThrow(/built for users of "admins"/);
		});

		it("fails at startup when a later plugin replaced baseAccess", async () => {
			const config = await build();
			const started = {
				collections: {
					uploads: { config: { ...uploadsOf(config), flattenedFields: [] } },
				},
				config: { baseAccess: { collections: { read: () => true } } },
				logger: { warn: () => undefined },
			} as unknown as Payload;

			await expect(config.onInit?.(started)).rejects.toThrow(
				/replaced config\.baseAccess/,
			);
		});
	});
});
