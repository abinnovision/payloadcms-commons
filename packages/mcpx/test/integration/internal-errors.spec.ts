import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { mcpPost } from "./helpers/mcp.js";
import { bootPayload, createKey } from "./helpers/payload.js";
import { defineMcpxTool } from "../../src/index.js";

import type { Booted } from "./helpers/payload.js";

const CACHE_KEY = "mcpx-integration-internal-errors";

const explodeTool = defineMcpxTool({
	name: "explode",
	description: "Throws an error carrying internal detail.",
	handler: () => {
		throw new Error("secret detail");
	},
});

describe("internal errors", () => {
	let booted: Booted;
	let key: string;

	beforeAll(async () => {
		booted = await bootPayload({
			key: CACHE_KEY,
			plugin: { tools: [explodeTool] },
		});

		const user = await booted.payload.create({
			collection: "users",
			data: { email: "errors@example.com", password: "errors-secret" },
		});

		key = await createKey(booted.payload, {
			userId: user.id,
			label: "errors",
			capabilities: { tools: { explode: true } },
		});
	});

	afterAll(async () => {
		await booted.payload.destroy();
	});

	it("reports a thrown error as a bare internal error", async () => {
		const response = await mcpPost(booted.config, {
			cacheKey: CACHE_KEY,
			key,
			body: {
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: { name: "explode", arguments: {} },
			},
		});
		const raw = await response.text();
		const body = JSON.parse(raw) as {
			result?: {
				content?: { type: string; text: string }[];
				isError?: boolean;
			};
		};

		expect(response.status).toBe(200);
		expect(body.result?.isError).toBe(true);
		expect(body.result?.content).toHaveLength(1);
		expect(JSON.parse(body.result?.content?.[0]?.text ?? "null")).toEqual({
			error: "Internal error",
		});
		expect(raw).not.toContain("secret detail");
		expect(raw).not.toMatch(/\bat .+:\d+:\d+/);
		expect(raw).not.toContain("stack");
	});
});
