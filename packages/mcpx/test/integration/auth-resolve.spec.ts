import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMcpClient, mcpPost } from "./helpers/mcp.js";
import { bootPayload, seedKeysFor } from "./helpers/payload.js";

import type { Booted } from "./helpers/payload.js";

const CAPABILITIES = { collections: { tags: { read: true } } };

describe("configured key resolution", () => {
	const CACHE_KEY = "mcpx-integration-auth-resolve";
	const THROWN = "resolver secret detail";
	let booted: Booted;
	let key: string;

	beforeAll(async () => {
		booted = await bootPayload({
			key: CACHE_KEY,
			plugin: {
				auth: {
					resolve: ({ req }) =>
						req.headers.get("x-resolve") === "throw"
							? Promise.reject(new Error(THROWN))
							: Promise.resolve(null),
				},
			},
		});

		key = (await seedKeysFor(booted.payload, { valid: CAPABILITIES })).keys
			.valid;
	});

	afterAll(async () => {
		await booted.payload.destroy();
	});

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
});
