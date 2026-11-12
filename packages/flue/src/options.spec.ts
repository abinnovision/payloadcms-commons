import { definePlugin } from "payload";
import { describe, expect, it } from "vitest";

import { mcpxSettings, normalizeOptions } from "./options.js";

import type {
	FlueAgentConfig,
	FlueAttachmentOptions,
	FluePluginOptions,
} from "./types.js";
import type { CollectionConfig, Config, PayloadRequest, Plugin } from "payload";

const SECRET = "s".repeat(32);
const MINUTE = 60_000;

type ConfigView = Pick<Config, "admin" | "collections" | "routes">;

const collection = (slug: string): CollectionConfig => ({ slug, fields: [] });

const config = (overrides: Partial<ConfigView> = {}): ConfigView => ({
	collections: [collection("users"), collection("mcpx-api-keys")],
	...overrides,
});

const plugins = (mcpxOptions?: Record<string, unknown>) => {
	const mcpx: Plugin = Object.assign((config: Config) => config, {
		slug: "@abinnovision/payloadcms-mcpx",
		...(mcpxOptions && { options: mcpxOptions }),
	});

	return { "@abinnovision/payloadcms-mcpx": mcpx };
};

const editor: FlueAgentConfig = {
	slug: "editor",
	capabilities: { collections: { pages: { read: true } } },
};

const options = (
	overrides: Partial<FluePluginOptions> = {},
): FluePluginOptions => ({
	sidecar: { url: "http://localhost:3101", secret: SECRET },
	agents: [editor],
	...overrides,
});

const normalize = (
	pluginOptions: FluePluginOptions = options(),
	view: ConfigView = config(),
) => {
	const warnings: string[] = [];
	const failures: Error[] = [];
	const normalized = normalizeOptions(view, pluginOptions, plugins(), {
		warn: (message) => {
			warnings.push(message);
		},
		fail: (error) => {
			failures.push(error);
		},
	});

	return { normalized, warnings, failures };
};

describe("mcpxSettings", () => {
	it("restates mcpx's defaults", () => {
		expect(mcpxSettings(config(), plugins())).toEqual({
			apiKeysSlug: "mcpx-api-keys",
			userCollection: "users",
			endpointPath: "/mcpx",
			mcpPath: "/api/mcpx",
		});
	});

	it("restates mcpx's defaults when mcpx was registered without options", () => {
		// definePlugin leaves `options` unset when the plugin is called without arguments.
		const mcpx = definePlugin<Record<string, unknown> | undefined>({
			slug: "@abinnovision/payloadcms-mcpx",
			plugin: ({ config }) => config,
		})();

		expect(mcpx.options).toBeUndefined();
		expect(
			mcpxSettings(config(), { "@abinnovision/payloadcms-mcpx": mcpx }),
		).toEqual({
			apiKeysSlug: "mcpx-api-keys",
			userCollection: "users",
			endpointPath: "/mcpx",
			mcpPath: "/api/mcpx",
		});
	});

	it("falls back to admin.user for the user collection", () => {
		expect(
			mcpxSettings(config({ admin: { user: "admins" } }), plugins())
				.userCollection,
		).toBe("admins");
	});

	it("reads mcpx's own options", () => {
		expect(
			mcpxSettings(
				config({ admin: { user: "admins" } }),
				plugins({
					apiKeys: { slug: "keys" },
					userCollection: "members",
					endpoint: { path: "/mcp" },
				}),
			),
		).toEqual({
			apiKeysSlug: "keys",
			userCollection: "members",
			endpointPath: "/mcp",
			mcpPath: "/api/mcp",
		});
	});

	it("builds mcpPath below a custom API route", () => {
		expect(
			mcpxSettings(config({ routes: { api: "/cms-api" } }), plugins()).mcpPath,
		).toBe("/cms-api/mcpx");
	});

	it("refuses a config without mcpx", () => {
		expect(() => mcpxSettings(config(), {})).toThrow(
			/@abinnovision\/payloadcms-mcpx/,
		);
	});
});

describe("normalizeOptions", () => {
	it("applies defaults", () => {
		const { normalized, warnings } = normalize();

		expect(normalized).toMatchObject({
			keyTtlMs: 2 * 60 * MINUTE,
			endpointPath: "/flue",
			threads: { slug: "flue-threads" },
			dispatch: { queue: "flue", wait: false },
			agentUser: undefined,
			mcpx: { apiKeysSlug: "mcpx-api-keys", mcpPath: "/api/mcpx" },
		});
		expect(
			normalized.threads.readAgentRuns({} as unknown as PayloadRequest),
		).toBe(false);
		expect(warnings).toEqual([]);
	});

	it("refuses a config without the mcpx API key collection", () => {
		expect(() =>
			normalize(options(), config({ collections: [collection("users")] })),
		).toThrow(/"mcpx-api-keys"/);
	});

	it.each(["/agents", "localhost:3101", "ftp://sidecar.internal"])(
		"refuses %s as the sidecar URL",
		(url) => {
			expect(() =>
				normalize(options({ sidecar: { url, secret: SECRET } })),
			).toThrow(/sidecar\.url/);
		},
	);

	it("refuses a secret shorter than 32 characters without echoing it", () => {
		const secret = "x".repeat(31);

		const run = () =>
			normalize(options({ sidecar: { url: "http://sidecar", secret } }));

		expect(run).toThrow(/sidecar\.secret/);
		expect(run).not.toThrow(secret);
	});

	it.each([
		["unset", undefined as unknown as string],
		["empty", ""],
	])("defers an %s sidecar URL and secret to startup", (_label, unset) => {
		const { failures } = normalize(
			options({ sidecar: { url: unset, secret: unset } }),
		);

		expect(failures).toEqual([
			expect.objectContaining({
				name: "InvalidConfiguration",
				message: expect.stringMatching(/sidecar\.url/) as unknown,
			}),
			expect.objectContaining({
				name: "InvalidConfiguration",
				message: expect.stringMatching(/sidecar\.secret/) as unknown,
			}),
		]);
	});

	it("defers nothing for a complete sidecar", () => {
		expect(normalize().failures).toEqual([]);
	});

	it.each(["flue", "/flue/", "/", "/my flue", ""])(
		"refuses %j as endpointPath",
		(endpointPath) => {
			expect(() => normalize(options({ endpointPath }))).toThrow(
				/endpointPath/,
			);
		},
	);

	it("refuses mcpx's endpoint path as endpointPath", () => {
		expect(() => normalize(options({ endpointPath: "/mcpx" }))).toThrow(
			/endpointPath "\/mcpx" is already mcpx's endpoint path/,
		);
	});

	it("refuses an empty agent list", () => {
		expect(() => normalize(options({ agents: [] }))).toThrow(/agents/);
	});

	it.each(["Editor", "1st", "", "a".repeat(64), "my_agent"])(
		"refuses %j as an agent slug",
		(slug) => {
			expect(() =>
				normalize(options({ agents: [editor, { ...editor, slug }] })),
			).toThrow(/agents\[1\]\.slug/);
		},
	);

	it("refuses two agents with the same slug", () => {
		expect(() => normalize(options({ agents: [editor, editor] }))).toThrow(
			/agents\[1\]\.slug "editor" is used by another agent/,
		);
	});

	it.each([5 * MINUTE - 1, 7 * 24 * 60 * MINUTE + 1, Number.NaN])(
		"refuses %d as keyTtlMs",
		(keyTtlMs) => {
			expect(() => normalize(options({ keyTtlMs }))).toThrow(/keyTtlMs/);
		},
	);

	it("refuses an ambient agent without agentUser.email", () => {
		const nightly = {
			...editor,
			ambient: { cron: "0 3 * * *", message: "Go" },
		};

		expect(() => normalize(options({ agents: [nightly] }))).toThrow(
			/agentUser\.email/,
		);
		expect(() =>
			normalize(options({ agents: [nightly], agentUser: { email: " " } })),
		).toThrow(/agentUser\.email/);
	});

	it("refuses an ambient agent with an empty cron", () => {
		const nightly = { ...editor, ambient: { cron: " ", message: "Go" } };

		expect(() =>
			normalize(
				options({ agents: [nightly], agentUser: { email: "agent@a.test" } }),
			),
		).toThrow(/agents\[0\]\.ambient\.cron/);
	});

	it("refuses an ambient agent with an empty message", () => {
		const nightly = { ...editor, ambient: { cron: "0 3 * * *", message: "" } };

		expect(() =>
			normalize(
				options({ agents: [nightly], agentUser: { email: "agent@a.test" } }),
			),
		).toThrow(/agents\[0\]\.ambient\.message/);
	});

	it("refuses a threads slug another collection holds", () => {
		expect(() => normalize(options({ threads: { slug: "users" } }))).toThrow(
			/threads\.slug "users"/,
		);
	});

	describe("dispatch.wait", () => {
		it("is off by default", () => {
			expect(normalize().normalized.dispatch.wait).toBe(false);
			expect(
				normalize(options({ dispatch: { wait: false } })).normalized.dispatch
					.wait,
			).toBe(false);
		});

		it("waits 10 minutes for true", () => {
			expect(
				normalize(options({ dispatch: { wait: true } })).normalized.dispatch
					.wait,
			).toEqual({ maxWaitMs: 10 * MINUTE });
		});

		it("takes a custom maxWaitMs", () => {
			expect(
				normalize(options({ dispatch: { wait: { maxWaitMs: 30_000 } } }))
					.normalized.dispatch,
			).toEqual({ queue: "flue", wait: { maxWaitMs: 30_000 } });
		});

		it.each([
			["zero", 0],
			["a negative value", -1],
			["Infinity", Number.POSITIVE_INFINITY],
		])("refuses %s", (_label, maxWaitMs) => {
			expect(() =>
				normalize(options({ dispatch: { wait: { maxWaitMs } } })),
			).toThrow(/dispatch\.wait\.maxWaitMs/);
		});
	});

	describe("attachments", () => {
		const MIB = 1024 * 1024;

		it("is off by default", () => {
			expect(normalize().normalized.attachments).toBe(false);
			expect(
				normalize(options({ attachments: false })).normalized.attachments,
			).toBe(false);
		});

		it("applies the defaults for true and sizes the body cap for four PDFs", () => {
			expect(
				normalize(options({ attachments: true })).normalized.attachments,
			).toEqual({
				mimeTypes: [
					"image/png",
					"image/jpeg",
					"image/gif",
					"image/webp",
					"application/pdf",
				],
				maxImageBytes: 3.75 * MIB,
				maxDocumentBytes: 5 * MIB,
				maxFiles: 4,
				bodyMax: 64 * 1024 + 4 * (Math.ceil((5 * MIB * 4) / 3) + 2048),
			});
		});

		it("sizes the body cap by the largest allowed type", () => {
			expect(
				normalize(
					options({
						attachments: {
							mimeTypes: ["image/png"],
							maxImageBytes: 3000,
							maxDocumentBytes: 10 * MIB,
							maxFiles: 2,
						},
					}),
				).normalized.attachments,
			).toEqual({
				mimeTypes: ["image/png"],
				maxImageBytes: 3000,
				maxDocumentBytes: 10 * MIB,
				maxFiles: 2,
				bodyMax: 64 * 1024 + 2 * (4000 + 2048),
			});
		});

		it.each([
			[
				"a type outside the five",
				{ mimeTypes: ["image/svg+xml"] },
				/mimeTypes/,
			],
			["an empty type list", { mimeTypes: [] }, /mimeTypes/],
			[
				"images over 3.75 MiB",
				{ maxImageBytes: 3.75 * MIB + 1 },
				/maxImageBytes/,
			],
			[
				"PDFs over 10 MiB",
				{ maxDocumentBytes: 10 * MIB + 1 },
				/maxDocumentBytes/,
			],
			["no files", { maxFiles: 0 }, /maxFiles/],
			["a fraction of a file", { maxFiles: 1.5 }, /maxFiles/],
			["more than 20 files", { maxFiles: 21 }, /maxFiles/],
		])("refuses %s", (_label, attachments, message) => {
			expect(() =>
				normalize(
					options({
						attachments: attachments as FlueAttachmentOptions,
					}),
				),
			).toThrow(message);
		});
	});
});
