import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMcpClient } from "./helpers/mcp.js";
import { bootPayload, createKey } from "./helpers/payload.js";
import { defineMcpxTool } from "../../src/index.js";
import { verifiedUsers } from "../fixtures/security.js";

import type { Booted } from "./helpers/payload.js";

const CAPABILITIES = { collections: { tags: { read: true } } };

const userFieldsTool = defineMcpxTool({
	name: "userFields",
	description: "Lists the fields of the user the request acts as.",
	handler: ({ req }) => ({
		content: [
			{ type: "text", text: JSON.stringify(Object.keys(req.user ?? {})) },
		],
	}),
});

describe("default key resolution against the user's state", () => {
	const CACHE_KEY = "mcpx-integration-auth-states";
	let booted: Booted;
	let seq = 0;

	beforeAll(async () => {
		booted = await bootPayload({
			key: CACHE_KEY,
			users: verifiedUsers,
			plugin: { tools: [userFieldsTool] },
		});
	});

	afterAll(async () => {
		await booted.payload.destroy();
	});

	const makeUser = async (verified: boolean): Promise<number | string> => {
		const user = await booted.payload.create({
			collection: "users",
			data: {
				email: `state-${String(++seq)}@example.com`,
				password: "state-secret",
				_verified: verified,
			},
			disableVerificationEmail: true,
		});

		return user.id;
	};

	it("accepts a key whose user is verified and unlocked", async () => {
		const userId = await makeUser(true);
		const key = await createKey(booted.payload, {
			userId,
			label: "verified",
			capabilities: CAPABILITIES,
		});

		expect((await createMcpClient(booted, key).rpc("tools/list")).status).toBe(
			200,
		);
	});

	it("refuses a key whose user was deleted", async () => {
		const userId = await makeUser(true);
		const key = await createKey(booted.payload, {
			userId,
			label: "orphaned",
			capabilities: CAPABILITIES,
		});

		/*
		 * SQLite refuses the delete itself: the key's required `user` column is
		 * NOT NULL with ON DELETE SET NULL. A store without referential
		 * integrity leaves the key behind, which is the state reproduced here.
		 */
		const client = (
			booted.payload.db as unknown as {
				client: { execute: (statement: string | object) => Promise<unknown> };
			}
		).client;

		await client.execute("PRAGMA foreign_keys = OFF");
		await client.execute({
			sql: "DELETE FROM users WHERE id = ?",
			args: [userId],
		});
		await client.execute("PRAGMA foreign_keys = ON");

		expect(
			await booted.payload.findByID({
				collection: "users",
				id: userId,
				disableErrors: true,
			}),
		).toBeNull();

		const { status, body } = await createMcpClient(booted, key).rpc(
			"tools/list",
		);

		expect(status).toBe(401);
		expect(body.error?.code).toBe(-32001);
	});

	it("refuses a key whose user is not verified", async () => {
		const userId = await makeUser(false);
		const key = await createKey(booted.payload, {
			userId,
			label: "unverified",
			capabilities: CAPABILITIES,
		});

		const { status, body } = await createMcpClient(booted, key).rpc(
			"tools/list",
		);

		expect(status).toBe(401);
		expect(body.error?.code).toBe(-32001);
	});

	it("refuses a key whose user is locked out", async () => {
		const userId = await makeUser(true);
		const key = await createKey(booted.payload, {
			userId,
			label: "locked",
			capabilities: CAPABILITIES,
		});

		// `lockUntil` denies update access to every caller, so the row is set directly.
		await booted.payload.db.updateOne({
			collection: "users",
			id: userId,
			data: {
				lockUntil: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
				loginAttempts: 5,
			},
		});

		const stored = await booted.payload.findByID({
			collection: "users",
			id: userId,
			showHiddenFields: true,
		});

		expect(Date.parse(String(stored["lockUntil"]))).toBeGreaterThan(Date.now());

		const { status, body } = await createMcpClient(booted, key).rpc(
			"tools/list",
		);

		expect(status).toBe(401);
		expect(body.error?.code).toBe(-32001);
	});

	it("hands tools a user without its hidden auth fields", async () => {
		const userId = await makeUser(true);
		const key = await createKey(booted.payload, {
			userId,
			label: "expired-lock",
			capabilities: { ...CAPABILITIES, tools: { userFields: true } },
		});

		// An expired lock, so the row carries a `lockUntil` that admits the key.
		await booted.payload.db.updateOne({
			collection: "users",
			id: userId,
			data: {
				lockUntil: new Date(Date.now() - 60 * 1000).toISOString(),
				loginAttempts: 5,
			},
		});

		const result = await createMcpClient(booted, key).call("userFields");
		const fields = JSON.parse(result.text ?? "[]") as string[];

		expect(result.isError).toBe(false);
		expect(fields).toContain("email");
		expect(fields).not.toContain("hash");
		expect(fields).not.toContain("salt");
		expect(fields).not.toContain("lockUntil");
		expect(fields).not.toContain("loginAttempts");
		expect(fields).not.toContain("_verificationToken");
	});
});
