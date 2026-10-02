import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { rpc } from "./helpers/mcp.js";
import { bootPayload, createKey } from "./helpers/payload.js";
import { verifiedUsers } from "../fixtures/security.js";

import type { Booted } from "./helpers/payload.js";

const CAPABILITIES = { collections: { tags: { read: true } } };

describe("default key resolution against the user's state", () => {
	const CACHE_KEY = "mcpx-integration-auth-states";
	let booted: Booted;
	let seq = 0;

	beforeAll(async () => {
		booted = await bootPayload({ key: CACHE_KEY, users: verifiedUsers });
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

	const listTools = (key: string) =>
		rpc(booted.config, key, "tools/list", undefined, CACHE_KEY);

	it("accepts a key whose user is verified and unlocked", async () => {
		const userId = await makeUser(true);
		const key = await createKey(booted.payload, {
			userId,
			label: "verified",
			capabilities: CAPABILITIES,
		});

		expect((await listTools(key)).status).toBe(200);
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

		const { status, body } = await listTools(key);

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

		const { status, body } = await listTools(key);

		expect(status).toBe(401);
		expect(body.error?.code).toBe(-32001);
	});

	it.fails("accepts a key whose user is locked out", async () => {
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

		const { status, body } = await listTools(key);

		expect(status).toBe(401);
		expect(body.error?.code).toBe(-32001);
	});
});
