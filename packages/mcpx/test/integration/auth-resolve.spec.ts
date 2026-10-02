import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { mcpPost, rpc } from "./helpers/mcp.js";
import { bootPayload, createKey } from "./helpers/payload.js";

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

		const user = await booted.payload.create({
			collection: "users",
			data: { email: "resolve@example.com", password: "resolve-secret" },
		});

		key = await createKey(booted.payload, {
			userId: user.id,
			label: "valid",
			capabilities: CAPABILITIES,
		});
	});

	afterAll(async () => {
		await booted.payload.destroy();
	});

	it("answers 401 when the resolver returns null, even for a valid key", async () => {
		const { status, body } = await rpc(
			booted.config,
			key,
			"tools/list",
			undefined,
			CACHE_KEY,
		);

		expect(status).toBe(401);
		expect(body.error?.code).toBe(-32001);
	});

	it("does not leak the message of a throwing resolver", async () => {
		const response = await mcpPost(booted.config, {
			cacheKey: CACHE_KEY,
			key,
			headers: { "x-resolve": "throw" },
			body: { jsonrpc: "2.0", id: 1, method: "tools/list" },
		});
		const text = await response.text();

		expect(response.status).toBeGreaterThanOrEqual(400);
		expect(text).not.toContain(THROWN);
		expect(text).not.toMatch(/\bat .+:\d+:\d+/);
	});
});
