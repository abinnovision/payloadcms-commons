import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createMcpClient } from "./helpers/mcp.js";
import { API_KEYS_SLUG, bootPayload, createKey } from "./helpers/payload.js";

import type { Booted } from "./helpers/payload.js";

const CAPABILITIES = { collections: { tags: { read: true } } };
const HOUR = 60 * 60 * 1000;

describe("api key expiry and last use", () => {
	let booted: Booted;
	let userId: number | string;
	let seq = 0;

	beforeAll(async () => {
		booted = await bootPayload({ key: "mcpx-integration-key-lifecycle" });
		userId = (
			await booted.payload.create({
				collection: "users",
				data: { email: "lifecycle@example.com", password: "lifecycle-secret" },
			})
		).id;
	});

	afterAll(async () => {
		await booted.payload.destroy();
	});

	const makeKey = async (): Promise<{ id: number | string; key: string }> => {
		const key = await createKey(booted.payload, {
			userId,
			label: `lifecycle-${String(++seq)}`,
			capabilities: CAPABILITIES,
		});
		const { docs } = await booted.payload.find({
			collection: API_KEYS_SLUG as never,
			where: { label: { equals: `lifecycle-${String(seq)}` } },
			limit: 1,
			overrideAccess: true,
		});

		return { id: (docs[0] as { id: number | string }).id, key };
	};

	// The field is read-only for every caller, so the row is set directly.
	const setDates = async (
		id: number | string,
		data: { expiresAt?: Date; lastUsedAt?: Date },
	): Promise<void> => {
		await booted.payload.db.updateOne({
			collection: API_KEYS_SLUG,
			id,
			data: Object.fromEntries(
				Object.entries(data).map(([name, date]) => [name, date.toISOString()]),
			),
			returning: false,
		});
	};

	const lastUsedAt = async (id: number | string): Promise<unknown> =>
		(
			(await booted.payload.findByID({
				collection: API_KEYS_SLUG as never,
				id,
				overrideAccess: true,
			})) as { lastUsedAt?: unknown }
		).lastUsedAt;

	const status = async (key: string): Promise<number> =>
		(await createMcpClient(booted, key).rpc("tools/list")).status;

	it("refuses a key whose expiry has passed", async () => {
		const { id, key } = await makeKey();

		await setDates(id, { expiresAt: new Date(Date.now() - 1000) });

		expect(await status(key)).toBe(401);
	});

	it("accepts a key whose expiry is in the future", async () => {
		const { id, key } = await makeKey();

		await setDates(id, { expiresAt: new Date(Date.now() + HOUR) });

		expect(await status(key)).toBe(200);
	});

	it("records the first use and keeps the key working", async () => {
		const { id, key } = await makeKey();

		expect(await lastUsedAt(id)).toBeFalsy();
		expect(await status(key)).toBe(200);
		expect(await lastUsedAt(id)).toBeTruthy();
		expect(await status(key)).toBe(200);
	});

	it("refreshes a last use older than an hour", async () => {
		const { id, key } = await makeKey();
		const stale = new Date(Date.now() - 2 * HOUR);

		await setDates(id, { lastUsedAt: stale });
		await status(key);

		expect(Date.parse(String(await lastUsedAt(id)))).toBeGreaterThan(
			stale.getTime() + HOUR,
		);
	});

	it("leaves a recent last use as it is", async () => {
		const { id, key } = await makeKey();
		const recent = new Date(Date.now() - 60 * 1000);

		await setDates(id, { lastUsedAt: recent });
		await status(key);

		expect(Date.parse(String(await lastUsedAt(id)))).toBe(recent.getTime());
	});

	it("authenticates when the last use cannot be recorded", async () => {
		const { key } = await makeKey();
		const update = vi
			.spyOn(booted.payload, "update")
			.mockRejectedValueOnce(new Error("write failed"));
		const warn = vi.spyOn(booted.payload.logger, "warn");

		expect(await status(key)).toBe(200);
		expect(warn).toHaveBeenCalledWith(
			expect.objectContaining({
				msg: expect.stringContaining("last use") as string,
			}),
		);

		update.mockRestore();
		warn.mockRestore();
	});
});
