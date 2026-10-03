import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createMcpClient, mcpPost } from "./helpers/mcp.js";
import {
	bootPayload,
	createMedia,
	PIXEL,
	seedKeysFor,
	storedState,
} from "./helpers/payload.js";

import type { Booted } from "./helpers/payload.js";
import type { McpxAuthResult } from "../../src/index.js";

const CAPABILITIES = {
	collections: {
		tags: { read: true },
		pages: { read: true, write: true },
		media: { read: true, write: true },
	},
};

describe("configured key resolution", () => {
	const CACHE_KEY = "mcpx-integration-auth-resolve";
	const THROWN = "resolver secret detail";
	let booted: Booted;
	let key: string;

	beforeAll(async () => {
		booted = await bootPayload({
			key: CACHE_KEY,
			collections: [{ slug: "editors", auth: true, fields: [] }],
			plugin: {
				collections: {
					pages: { publish: false },
					tags: { write: false },
					media: { publish: false },
				},
				auth: {
					resolve: async ({ req, resolveDefault }) => {
						const mode = req.headers.get("x-resolve");

						if (mode === "throw") {
							throw new Error(THROWN);
						}

						if (mode === null) {
							return null;
						}

						const auth = await resolveDefault();

						if (!auth || mode === "wrap") {
							return auth;
						}

						const { user, apiKeyId, ...rest } = auth;
						const collections: Record<string, string> = {
							editors: "editors",
							unknown: "unknown",
						};

						const broken: Record<string, unknown> = {
							...rest,
							user:
								mode === "no-id"
									? { collection: user.collection }
									: { ...user, collection: collections[mode] },
							apiKeyId: mode === "no-key-id" ? undefined : apiKeyId,
						};

						return broken as unknown as McpxAuthResult;
					},
				},
			},
		});

		key = (await seedKeysFor(booted.payload, { valid: CAPABILITIES })).keys
			.valid;
	});

	afterAll(async () => {
		await booted.payload.destroy();
	});

	const createPage = (mode: string) =>
		mcpPost(booted, {
			key,
			headers: { "x-resolve": mode },
			body: {
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: {
					name: "createDocument",
					arguments: {
						collection: "pages",
						locale: "en",
						data: { title: "Written" },
					},
				},
			},
		});

	const pages = async () =>
		(await storedState(booted.payload, { collections: ["pages"] }))["pages"];

	it("answers 401 when the resolver returns null, even for a valid key", async () => {
		const { status, body } = await createMcpClient(booted, key).rpc(
			"tools/list",
		);

		expect(status).toBe(401);
		expect(body.error?.code).toBe(-32001);
	});

	it("does not leak the message of a throwing resolver", async () => {
		const response = await mcpPost(booted, {
			key,
			headers: { "x-resolve": "throw" },
			body: { jsonrpc: "2.0", id: 1, method: "tools/list" },
		});
		const text = await response.text();

		expect(response.status).toBe(500);
		expect(text).not.toContain(THROWN);
		expect(text).not.toMatch(/\bat .+:\d+:\d+/);
	});

	it.each([
		["a user without an id", "no-id"],
		["a user of another auth collection", "editors"],
		["a user with an unknown collection", "unknown"],
		["a missing apiKeyId", "no-key-id"],
	])("answers 401, logs once and writes nothing for %s", async (_, mode) => {
		const before = await pages();
		const error = vi.spyOn(booted.payload.logger, "error");

		expect((await createPage(mode)).status).toBe(401);
		expect(await pages()).toEqual(before);
		expect(error).toHaveBeenCalledWith(
			expect.stringContaining("auth.resolve returned an invalid result"),
		);

		error.mockRestore();
	});

	it("serves a resolver that wraps the default resolver", async () => {
		expect((await createPage("wrap")).status).toBe(200);
		expect(await pages()).toMatchObject({ docs: [expect.anything()] });
	});

	/*
	 * The upload endpoint authenticates by the key alone and cannot replay a
	 * resolver, so no tool offers a file.
	 */
	it("offers no file and refuses one", async () => {
		const call = async (method: string, params?: unknown) =>
			(await (
				await mcpPost(booted, {
					key,
					headers: { "x-resolve": "wrap" },
					body: { jsonrpc: "2.0", id: 1, method, params },
				})
			).json()) as {
				result?: {
					tools?: { inputSchema: { properties?: object } }[];
					isError?: boolean;
				};
			};
		const { id } = await createMedia(booted.payload, "Resolved");
		const before = await storedState(booted.payload, {
			collections: ["media"],
		});

		expect(
			(await call("tools/list")).result?.tools?.flatMap((tool) =>
				Object.keys(tool.inputSchema.properties ?? {}),
			),
		).not.toContain("file");
		expect(
			(
				await call("tools/call", {
					name: "patchDocument",
					arguments: {
						collection: "media",
						id,
						locale: "en",
						patches: [],
						file: {
							filename: "pixel.png",
							mimeType: "image/png",
							size: PIXEL.length,
						},
					},
				})
			).result?.isError,
		).toBe(true);
		expect(
			await storedState(booted.payload, { collections: ["media"] }),
		).toEqual(before);
	});
});
