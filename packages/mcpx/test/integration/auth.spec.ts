import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { mcpPost, rpc } from "./helpers/mcp.js";
import { bootPayload, seedKeys, USER } from "./helpers/payload.js";

import type { Booted, Seeded } from "./helpers/payload.js";

describe("mcp endpoint authentication", () => {
	let booted: Booted;
	let seeded: Seeded;

	beforeAll(async () => {
		booted = await bootPayload();
		seeded = await seedKeys(booted.payload);
	});

	afterAll(async () => {
		await booted.payload.destroy();
	});

	it("refuses a request without a key", async () => {
		const { status, body } = await rpc(booted.config, undefined, "tools/list");

		expect(status).toBe(401);
		expect(body.error?.code).toBe(-32001);
	});

	it("answers 401 with a WWW-Authenticate challenge", async () => {
		const response = await mcpPost(booted.config, {
			body: { jsonrpc: "2.0", id: 1, method: "tools/list" },
		});

		expect(response.status).toBe(401);
		expect(response.headers.get("www-authenticate")).toBe("Bearer");
	});

	it("refuses an unknown key", async () => {
		const { status } = await rpc(booted.config, "not-a-key", "tools/list");

		expect(status).toBe(401);
	});

	it("refuses a disabled key", async () => {
		const { status } = await rpc(
			booted.config,
			seeded.keys.disabled,
			"tools/list",
		);

		expect(status).toBe(401);
	});

	it("accepts a valid key", async () => {
		const { status, body } = await rpc(
			booted.config,
			seeded.keys.full,
			"tools/list",
		);

		expect(status).toBe(200);
		expect(body.result?.tools?.length).toBeGreaterThan(0);
	});

	it("ignores an admin session that carries no key", async () => {
		const { token } = await booted.payload.login({
			collection: "users",
			data: USER,
		});

		const viaCookie = await mcpPost(booted.config, {
			headers: { cookie: `payload-token=${String(token)}` },
			body: { jsonrpc: "2.0", id: 1, method: "tools/list" },
		});
		const viaBearer = await mcpPost(booted.config, {
			key: String(token),
			body: { jsonrpc: "2.0", id: 1, method: "tools/list" },
		});

		expect(viaCookie.status).toBe(401);
		expect(viaBearer.status).toBe(401);
	});

	it("answers GET and DELETE with 405", async () => {
		for (const method of ["GET", "DELETE"]) {
			const response = await mcpPost(booted.config, {
				key: seeded.keys.full,
				method,
			});

			expect(response.status).toBe(405);
			expect(response.headers.get("allow")).toBe("POST");
		}
	});

	it("answers malformed JSON with a parse error", async () => {
		const response = await mcpPost(booted.config, {
			key: seeded.keys.full,
			rawBody: "{not json",
		});
		const body = (await response.json()) as { error?: { code: number } };

		expect(response.status).toBe(400);
		expect(body.error?.code).toBe(-32700);
	});
});
