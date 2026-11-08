import { createPayloadRequest } from "payload";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
	API_KEYS_SLUG,
	bootPayload,
	keySettings,
	login,
	seed,
	send,
	shutdown,
	USERS,
} from "./helpers/payload.js";
import { ensureAgentKey } from "../../src/keys/manager.js";
import { EDITOR, RESTRICTED } from "../fixtures/config.js";

import type { Booted, Doc, Seeded, SeededUser } from "./helpers/payload.js";
import type { FlueAgentConfig } from "../../src/index.js";

describe("managed keys", () => {
	let booted: Booted;
	let seeded: Seeded;

	const internalReq = () => createPayloadRequest({ payload: booted.payload });

	const ensureKey = async (
		user: SeededUser,
		agent: FlueAgentConfig = EDITOR,
	): Promise<number | string> =>
		(
			await ensureAgentKey(booted.payload, keySettings(booted.payload), {
				userId: user.id,
				agent,
				req: await internalReq(),
			})
		).id;

	const createOwnKey = async (user: SeededUser): Promise<number | string> =>
		(
			await booted.payload.create({
				collection: API_KEYS_SLUG,
				data: {
					label: "Own key",
					user: user.id,
					capabilities: { collections: { pages: { read: true } } },
				},
				overrideAccess: true,
			})
		).id;

	// The whole row, read past access control.
	const stored = async (id: number | string): Promise<Doc | null> =>
		await booted.payload.findByID({
			collection: API_KEYS_SLUG,
			id,
			depth: 0,
			overrideAccess: true,
			showHiddenFields: true,
			disableErrors: true,
		});

	const restRead = async (id: number | string, query = ""): Promise<Doc> => {
		const response = await send(
			booted,
			`/api/${API_KEYS_SLUG}/${String(id)}${query}`,
			{
				token: seeded.first.token,
			},
		);

		expect(response.status).toBe(200);

		return (await response.json()) as Doc;
	};

	// The four reads the owner can make of a key, each as the owner.
	const ownerReads = async (id: number | string): Promise<Doc[]> => {
		const user = await booted.payload.findByID({
			collection: "users",
			id: seeded.first.id,
			overrideAccess: true,
		});

		return [
			await restRead(id),
			await restRead(id, "?select[apiKey]=true"),
			await restRead(id, "?select[managedBy]=false"),
			await booted.payload.findByID({
				collection: API_KEYS_SLUG,
				id,
				overrideAccess: false,
				user: { ...user, collection: "users" },
			}),
		];
	};

	beforeAll(async () => {
		booted = await bootPayload("flue-keys");
		seeded = await seed(booted.payload);
	});

	afterAll(async () => {
		await shutdown(booted);
	});

	describe("ensureAgentKey", () => {
		it("keeps one key per user and agent", async () => {
			const first = await ensureKey(seeded.second);
			const second = await ensureKey(seeded.second);
			const other = await ensureKey(seeded.second, RESTRICTED);
			const { docs } = await booted.payload.find({
				collection: API_KEYS_SLUG,
				where: {
					and: [
						{ user: { equals: seeded.second.id } },
						{ managedBy: { equals: "flue:editor" } },
					],
				},
				overrideAccess: true,
			});

			expect(second).toBe(first);
			expect(other).not.toBe(first);
			expect(docs.map((doc) => doc.id)).toEqual([first]);
		});

		it("leaves a fresh, enabled, matching key unwritten", async () => {
			const id = await ensureKey(seeded.first);
			const before = await stored(id);

			// Long enough for a write to change `updatedAt`.
			await new Promise((resolve) => {
				setTimeout(resolve, 5);
			});

			const { expiresAt } = await ensureAgentKey(
				booted.payload,
				keySettings(booted.payload),
				{ userId: seeded.first.id, agent: EDITOR, req: await internalReq() },
			);

			expect(await stored(id)).toEqual(before);
			expect(expiresAt).toBe(before?.["expiresAt"]);
		});

		it("re-enables the key on the turn after logout", async () => {
			const id = await ensureKey(seeded.first);
			// A session of its own, so the shared token stays signed in.
			const token = await login(booted.payload, "users", USERS.first);

			await send(booted, "/api/users/logout", { method: "POST", token });

			expect((await stored(id))?.["enabled"]).toBe(false);

			await ensureKey(seeded.first);

			expect((await stored(id))?.["enabled"]).toBe(true);
		});

		it("rolls the expiry once less than half the TTL remains", async () => {
			const { keyTtlMs } = keySettings(booted.payload);
			const id = await ensureKey(seeded.first);

			await booted.payload.update({
				collection: API_KEYS_SLUG,
				id,
				data: {
					expiresAt: new Date(Date.now() + keyTtlMs / 2 - 1000).toISOString(),
				},
				overrideAccess: true,
			});

			const before = Date.now();

			await ensureKey(seeded.first);

			expect(
				Date.parse(String((await stored(id))?.["expiresAt"])),
			).toBeGreaterThanOrEqual(before + keyTtlMs);
		});

		it("rolls an expiry longer than the TTL back", async () => {
			const { keyTtlMs } = keySettings(booted.payload);
			const id = await ensureKey(seeded.first);

			await booted.payload.update({
				collection: API_KEYS_SLUG,
				id,
				data: {
					expiresAt: new Date(Date.now() + 10 * keyTtlMs).toISOString(),
				},
				overrideAccess: true,
			});

			const before = Date.now();

			await ensureKey(seeded.first);

			const rolled = Date.parse(String((await stored(id))?.["expiresAt"]));

			expect(rolled).toBeGreaterThanOrEqual(before + keyTtlMs);
			expect(rolled).toBeLessThanOrEqual(Date.now() + keyTtlMs);
		});

		it("resets a privileged capability edit on the next turn", async () => {
			const id = await ensureKey(seeded.first);

			await booted.payload.update({
				collection: API_KEYS_SLUG,
				id,
				data: {
					capabilities: {
						collections: {
							pages: { publish: true },
							posts: { write: true, delete: false },
						},
					},
				},
				overrideAccess: true,
			});

			await ensureKey(seeded.first);

			expect((await stored(id))?.["capabilities"]).toEqual({
				collections: {
					pages: { read: true, write: true, publish: false },
					posts: { read: true, write: false, delete: true },
				},
			});
		});
	});

	describe("the apiKey read lock", () => {
		it("hides the key of a managed row from every read of its owner", async () => {
			const id = await ensureKey(seeded.first);

			for (const doc of await ownerReads(id)) {
				expect(doc.id).toBe(id);
				expect(doc).not.toHaveProperty("apiKey");
			}
		});

		it("returns the key of an unmanaged row to the same reads", async () => {
			const id = await createOwnKey(seeded.first);

			for (const doc of await ownerReads(id)) {
				expect(doc["apiKey"]).toEqual(expect.any(String));
			}
		});
	});

	describe("the update and delete lock", () => {
		it("refuses the owner's update and delete of a managed key", async () => {
			const id = await ensureKey(seeded.first);
			const before = await stored(id);

			const updated = await send(
				booted,
				`/api/${API_KEYS_SLUG}/${String(id)}`,
				{
					method: "PATCH",
					token: seeded.first.token,
					body: { label: "Renamed", enabled: false },
				},
			);
			const deleted = await send(
				booted,
				`/api/${API_KEYS_SLUG}/${String(id)}`,
				{
					method: "DELETE",
					token: seeded.first.token,
				},
			);

			expect(updated.status).toBe(403);
			expect(deleted.status).toBe(403);
			expect(await stored(id)).toEqual(before);
		});

		it("lets the owner update an unmanaged key of their own", async () => {
			const id = await createOwnKey(seeded.first);

			const updated = await send(
				booted,
				`/api/${API_KEYS_SLUG}/${String(id)}`,
				{
					method: "PATCH",
					token: seeded.first.token,
					body: { label: "Renamed" },
				},
			);

			expect(updated.status).toBe(200);
			expect((await stored(id))?.["label"]).toBe("Renamed");
		});
	});

	describe("logout", () => {
		it("disables the user's managed keys and leaves the other user's enabled", async () => {
			const own = await ensureKey(seeded.first);
			const unmanaged = await createOwnKey(seeded.first);
			const other = await ensureKey(seeded.second);
			// A session of its own, so the shared token stays signed in.
			const token = await login(booted.payload, "users", USERS.first);

			const response = await send(booted, "/api/users/logout", {
				method: "POST",
				token,
			});

			expect(response.status).toBe(200);
			expect((await stored(own))?.["enabled"]).toBe(false);
			expect((await stored(unmanaged))?.["enabled"]).toBe(true);
			expect((await stored(other))?.["enabled"]).toBe(true);
		});
	});
});
