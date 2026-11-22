import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMcpClient, mcpPost } from "./helpers/mcp.js";
import { bootPayload, seedKeysFor, USER } from "./helpers/payload.js";

import type { Booted } from "./helpers/payload.js";
import type { PayloadRequest } from "payload";

describe("the MCP endpoint with admin autologin", () => {
	let booted: Booted;
	let key: string;
	// The user each request reached `auth.resolve` with.
	const seen: PayloadRequest["user"][] = [];

	beforeAll(async () => {
		booted = await bootPayload({
			key: "mcpx-integration-autologin",
			admin: { autoLogin: { email: USER.email } },
			plugin: {
				auth: {
					resolve: async ({ req, resolveDefault }) => {
						seen.push(req.user);

						return await resolveDefault();
					},
				},
			},
		});
		({
			keys: { reader: key },
		} = await seedKeysFor(booted.payload, {
			reader: { collections: { tags: { read: true } } },
		}));
	});

	afterAll(async () => {
		await booted.payload.destroy();
	});

	it("answers a request without credentials with 401, not as the autologin user", async () => {
		seen.length = 0;

		const response = await mcpPost(booted, {
			body: { jsonrpc: "2.0", id: 1, method: "tools/list" },
		});

		expect(response.status).toBe(401);
		expect(seen).toEqual([null]);
	});

	it("still serves a valid key", async () => {
		expect((await createMcpClient(booted, key).rpc("tools/list")).status).toBe(
			200,
		);
	});
});
