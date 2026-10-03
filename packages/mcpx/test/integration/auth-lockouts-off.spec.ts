import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMcpClient } from "./helpers/mcp.js";
import { bootPayload, createKey } from "./helpers/payload.js";
import { lockoutFreeUsers } from "../fixtures/security.js";

import type { Booted } from "./helpers/payload.js";

describe("default key resolution without lockouts", () => {
	let booted: Booted;

	beforeAll(async () => {
		booted = await bootPayload({
			key: "mcpx-integration-auth-lockouts-off",
			users: lockoutFreeUsers,
		});
	});

	afterAll(async () => {
		await booted.payload.destroy();
	});

	it("accepts a key when the user collection has no lockUntil field", async () => {
		const user = await booted.payload.create({
			collection: "users",
			data: { email: "no-lockout@example.com", password: "state-secret" },
		});
		const key = await createKey(booted.payload, {
			userId: user.id,
			label: "no-lockout",
			capabilities: { collections: { tags: { read: true } } },
		});

		expect(
			booted.payload.collections["users"]?.config.flattenedFields.map(
				(field) => field.name,
			),
		).not.toContain("lockUntil");
		expect((await createMcpClient(booted, key).rpc("tools/list")).status).toBe(
			200,
		);
	});
});
