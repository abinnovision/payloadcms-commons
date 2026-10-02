import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { callToolBatch, mcpPost } from "./helpers/mcp.js";
import { bootPayload, createKey } from "./helpers/payload.js";
import { ledgers } from "../fixtures/security.js";

import type { Booted } from "./helpers/payload.js";

const CACHE_KEY = "mcpx-integration-batch";

/*
 * The fixture adapter runs without transactions, so nothing could roll back
 * there. A file database because a libsql transaction on `:memory:` opens a
 * second, empty database.
 */
const DB_FILE = join(tmpdir(), `mcpx-batch-${String(process.pid)}.db`);

const removeDbFiles = async (): Promise<void> => {
	for (const suffix of ["", "-wal", "-shm", "-journal"]) {
		await rm(`${DB_FILE}${suffix}`, { force: true });
	}
};

describe("json-rpc batches", () => {
	let booted: Booted;
	let key: string;

	beforeAll(async () => {
		await removeDbFiles();

		booted = await bootPayload({
			key: CACHE_KEY,
			db: sqliteAdapter({
				client: { url: `file:${DB_FILE}` },
				transactionOptions: {},
			}),
			collections: [ledgers],
			plugin: { collections: { ledgers: { read: true, write: "draft" } } },
		});

		const user = await booted.payload.create({
			collection: "users",
			data: { email: "batch@example.com", password: "batch-secret" },
		});

		key = await createKey(booted.payload, {
			userId: user.id,
			label: "batch",
			capabilities: { collections: { ledgers: { read: true, write: true } } },
		});
	});

	afterAll(async () => {
		await booted.payload.destroy();
		await removeDbFiles();
	});

	const draftTitle = async (id: number | string): Promise<unknown> =>
		(
			(await booted.payload.findByID({
				collection: "ledgers" as never,
				id,
				draft: true,
				overrideAccess: true,
			})) as unknown as { title?: unknown }
		).title;

	it.fails("accepts a batch of 50 tool calls", async () => {
		const messages = Array.from({ length: 50 }, (_, index) => ({
			jsonrpc: "2.0",
			id: index + 1,
			method: "tools/call",
			params: { name: "listCapabilities", arguments: {} },
		}));

		const response = await mcpPost(booted.config, {
			cacheKey: CACHE_KEY,
			key,
			body: messages,
		});
		const body = (await response.json()) as unknown;

		expect(response.status >= 400 || !Array.isArray(body)).toBe(true);
	});

	it("keeps the first write of a batch when the second one fails", async () => {
		const create = (title: string, frozen: boolean) =>
			booted.payload.create({
				collection: "ledgers" as never,
				data: { title, frozen },
			});

		const open = await create("Open before", false);
		const frozen = await create("Frozen before", true);

		const results = await callToolBatch(
			booted.config,
			key,
			[
				{
					name: "patchDocument",
					args: {
						collection: "ledgers",
						id: open.id,
						locale: "en",
						patches: [{ op: "replace", path: "/title", value: "Open after" }],
					},
				},
				{
					name: "patchDocument",
					args: {
						collection: "ledgers",
						id: frozen.id,
						locale: "en",
						patches: [{ op: "replace", path: "/title", value: "Frozen after" }],
					},
				},
			],
			CACHE_KEY,
		);

		expect(results.map((result) => result.isError)).toEqual([false, true]);
		expect(await draftTitle(frozen.id)).toBe("Frozen before");
		expect(await draftTitle(open.id)).toBe("Open after");
	});
});
