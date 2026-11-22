import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildConfig, getPayload, inMemoryKVAdapter } from "payload";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
	API_KEYS_SLUG,
	bootPayload,
	count,
	exchange,
	liveToken,
	login,
	mcpRpc,
	openWindow,
	seed,
	send,
	shutdown,
	THREADS_SLUG,
	USERS,
	windowOpen,
} from "./helpers/payload.js";
import { handleHash } from "../../src/threads/handle.js";
import {
	mintToken,
	purgeExpiredTokens,
	readToken,
} from "../../src/tokens/store.js";
import { EDITOR, fixtureConfig, RESTRICTED } from "../fixtures/config.js";

import type { Booted, Seeded } from "./helpers/payload.js";
import type { CollectionAfterLogoutHook } from "payload";

const KV_SLUG = "payload-kv";
const HOUR = 60 * 60_000;

const sha256 = (value: string): string =>
	createHash("sha256").update(value).digest("hex");

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

// Every KV row as JSON, to search for what was stored.
const kvDump = async (booted: Booted): Promise<string> =>
	JSON.stringify(
		(
			await booted.payload.db.find({
				collection: KV_SLUG,
				limit: 0,
				pagination: false,
				req: {},
			})
		).docs,
	);

describe("agent tokens", () => {
	let booted: Booted;
	let seeded: Seeded;

	beforeAll(async () => {
		booted = await bootPayload("flue-tokens");
		seeded = await seed(booted.payload);
	});

	afterAll(async () => {
		await shutdown(booted);
	});

	it("keeps one live window row per thread across turns", async () => {
		await openWindow(booted, seeded.first.id, 101);
		await openWindow(booted, seeded.first.id, 101);

		const { totalDocs } = await booted.payload.db.count({
			collection: KV_SLUG,
			where: { key: { equals: `flue-live:${String(seeded.first.id)}:101` } },
			req: {},
		});

		expect(totalDocs).toBe(1);
	});

	it("stores only a token's SHA-256 and caps its expiry at the window", async () => {
		const windowExp = await openWindow(booted, seeded.first.id, 102, 60_000);
		const { token, exp } = await mintToken(
			booted.payload,
			{
				user: seeded.first.id,
				thread: 102,
				agent: EDITOR.slug,
				kind: "chat",
				gen: "g",
			},
			HOUR,
			windowExp,
		);
		const dump = await kvDump(booted);

		expect(token).toMatch(/^flue_[\w-]{43}$/);
		expect(exp).toBe(windowExp);
		expect(dump).not.toContain(token);
		expect(dump).toContain(`flue-token:${sha256(token)}`);
	});

	it("purges expired tokens and keeps live ones", async () => {
		const grant = {
			user: seeded.first.id,
			thread: 103,
			agent: EDITOR.slug,
			kind: "chat" as const,
			gen: "g",
		};
		const { token: stale } = await mintToken(
			booted.payload,
			grant,
			HOUR,
			Date.now() - 1,
		);
		const { token: live } = await mintToken(
			booted.payload,
			grant,
			HOUR,
			Date.now() + HOUR,
		);

		expect(await kvDump(booted)).toContain(sha256(stale));

		await purgeExpiredTokens(booted.payload);

		expect(await readToken(booted.payload, stale)).toBeUndefined();
		expect(await kvDump(booted)).not.toContain(sha256(stale));
		expect(await kvDump(booted)).toContain(sha256(live));
	});

	it("answers /me for a token with the token's expiry", async () => {
		const token = await liveToken(booted, seeded.first.id, 106);
		const response = await send(booted, "/api/users/me", {
			headers: bearer(token),
		});
		const body = (await response.json()) as {
			user: { id: unknown };
			exp: number;
		};

		expect(response.status).toBe(200);
		expect(body.user.id).toBe(seeded.first.id);
		expect(body.exp * 1000).toBeGreaterThan(Date.now());
		expect(body.exp * 1000).toBeLessThanOrEqual(Date.now() + HOUR);
	});

	it("stops a chat token once the agent's access no longer admits its user", async () => {
		const user = await booted.payload.create({
			collection: "users",
			data: {
				email: `${randomUUID()}@example.com`,
				password: "demoted-secret",
				agentAccess: true,
			},
			overrideAccess: true,
		});
		const token = await liveToken(booted, user.id, 107, RESTRICTED.slug);

		expect((await mcpRpc(booted, token, "tools/list")).status).toBe(200);

		await booted.payload.update({
			collection: "users",
			id: user.id,
			data: { agentAccess: false },
			overrideAccess: true,
		});

		expect((await mcpRpc(booted, token, "tools/list")).status).toBe(401);
	});

	it("refuses a token whose agent is no longer configured", async () => {
		const token = await liveToken(booted, seeded.first.id, 104, "retired");

		expect((await mcpRpc(booted, token, "tools/list")).status).toBe(401);
	});

	it("never hands a token to the logger", async () => {
		const logged: string[] = [];
		const spies = (["error", "warn", "info", "debug"] as const).map((level) =>
			vi.spyOn(booted.payload.logger, level).mockImplementation((...args) => {
				logged.push(JSON.stringify(args));
			}),
		);
		const handle = randomUUID();
		const thread = await booted.payload.create({
			collection: THREADS_SLUG,
			data: {
				agent: EDITOR.slug,
				kind: "chat",
				conversationId: randomUUID(),
				handleHash: handleHash(handle),
				createdBy: { relationTo: "users", value: seeded.first.id },
			},
			overrideAccess: true,
		});

		try {
			await openWindow(booted, seeded.first.id, thread.id);

			const { key } = (await (
				await exchange(booted, { handle, agent: EDITOR.slug })
			).json()) as { key: string };
			const forged = `flue_${"x".repeat(43)}`;

			await mcpRpc(booted, key, "tools/list");
			await send(booted, "/api/pages", { headers: bearer(key) });
			await mcpRpc(booted, forged, "tools/list");
			await openWindow(booted, seeded.first.id, thread.id, -1);
			await mcpRpc(booted, key, "tools/list");

			expect(key).toMatch(/^flue_/);
			expect(logged.join("\n")).not.toContain(key);
			expect(logged.join("\n")).not.toContain(forged);
		} finally {
			for (const spy of spies) {
				spy.mockRestore();
			}
		}
	});

	describe("refusals", () => {
		let token: string;

		beforeAll(async () => {
			token = await liveToken(booted, seeded.first.id, 105);
		});

		it("refuses the token at the flue session endpoints", async () => {
			const response = await send(booted, "/api/flue/agents", {
				headers: bearer(token),
			});

			expect(response.status).toBe(403);
		});

		it("refuses to refresh the token into a JWT", async () => {
			const response = await send(booted, "/api/users/refresh-token", {
				method: "POST",
				headers: bearer(token),
			});

			expect(response.status).toBe(403);
			expect(response.headers.get("set-cookie")).toBeNull();
		});

		it("refuses the token at mcpx's decide endpoint", async () => {
			const response = await send(booted, "/api/mcpx/confirmations", {
				method: "POST",
				body: {
					principal: "flue-thread:105",
					handles: ["h"],
					decision: "approved",
				},
				headers: bearer(token),
			});

			expect(response.status).toBe(403);
		});

		it("refuses the token on mcpx's key collection and writes nothing", async () => {
			const before = await count(booted, API_KEYS_SLUG);
			const created = await send(booted, `/api/${API_KEYS_SLUG}`, {
				method: "POST",
				body: { label: "Escalated", user: seeded.first.id },
				headers: bearer(token),
			});
			const listed = await send(booted, `/api/${API_KEYS_SLUG}`, {
				headers: bearer(token),
			});

			expect(created.status).toBe(403);
			expect(listed.status).toBe(403);
			expect(await count(booted, API_KEYS_SLUG)).toBe(before);
		});
	});

	it("closes every window of a user on logout and leaves the other user's open", async () => {
		const token = await liveToken(booted, seeded.first.id, 201);

		await openWindow(booted, seeded.first.id, 202);
		await openWindow(booted, seeded.second.id, 203);

		// A session of its own, so the shared token stays signed in.
		const session = await login(booted.payload, "users", USERS.first);
		const response = await send(booted, "/api/users/logout", {
			method: "POST",
			token: session,
		});

		expect(response.status).toBe(200);
		expect(await windowOpen(booted, seeded.first.id, 201)).toBe(false);
		expect(await windowOpen(booted, seeded.first.id, 202)).toBe(false);
		expect(await windowOpen(booted, seeded.second.id, 203)).toBe(true);
		expect((await mcpRpc(booted, token, "tools/list")).status).toBe(401);

		// A later turn opens a new window; the token of the earlier one stays refused.
		await openWindow(booted, seeded.first.id, 201);

		expect((await mcpRpc(booted, token, "tools/list")).status).toBe(401);
	});
});

describe("a logout that rolls back", () => {
	let booted: Booted;
	let dir: string;

	beforeAll(async () => {
		dir = await mkdtemp(join(tmpdir(), "flue-tokens-"));
		booted = await bootPayload("flue-tokens-rollback", undefined, {
			db: sqliteAdapter({
				client: { url: `file:${join(dir, "db.sqlite")}` },
				transactionOptions: {},
			}),
		});
	});

	afterAll(async () => {
		await shutdown(booted);
		await rm(dir, { recursive: true, force: true });
	});

	it("keeps the user's windows open", async () => {
		const seeded = await seed(booted.payload);
		const hooks = booted.payload.collections["users"]!.config.hooks;
		const failing: CollectionAfterLogoutHook = () => {
			throw new Error("A later logout hook failed.");
		};

		await openWindow(booted, seeded.first.id, 301);
		hooks.afterLogout.push(failing);

		try {
			const response = await send(booted, "/api/users/logout", {
				method: "POST",
				token: seeded.first.token,
			});

			expect(response.status).toBe(500);
		} finally {
			hooks.afterLogout.pop();
		}

		expect(await windowOpen(booted, seeded.first.id, 301)).toBe(true);
	});
});

describe("a config without Payload's database KV", () => {
	it("fails startup", async () => {
		await expect(
			getPayload({
				config: buildConfig({
					...fixtureConfig({ sidecarUrl: "http://127.0.0.1:9" }),
					kv: inMemoryKVAdapter(),
				}),
				key: "flue-tokens-memory-kv",
			}),
		).rejects.toThrow(/database KV adapter/);
	});
});
