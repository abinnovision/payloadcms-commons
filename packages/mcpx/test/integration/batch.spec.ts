import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMcpClient, mcpPost } from "./helpers/mcp.js";
import { bootPayload, seedKeysFor } from "./helpers/payload.js";
import { ledgers } from "../fixtures/security.js";

import type { McpClient } from "./helpers/mcp.js";
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
	let mcp: McpClient;

	beforeAll(async () => {
		await removeDbFiles();

		booted = await bootPayload({
			key: CACHE_KEY,
			db: sqliteAdapter({
				client: { url: `file:${DB_FILE}` },
				transactionOptions: {},
			}),
			collections: [ledgers],
			plugin: { collections: { ledgers: { publish: false } } },
		});

		key = (
			await seedKeysFor(booted.payload, {
				batch: { collections: { ledgers: { read: true, write: true } } },
			})
		).keys.batch;
		mcp = createMcpClient(booted, key);
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

	it("refuses a batch of 11 messages and creates nothing", async () => {
		const before = await booted.payload.count({
			collection: "ledgers" as never,
		});
		const messages = Array.from({ length: 11 }, (_, index) => ({
			jsonrpc: "2.0",
			id: index + 1,
			method: "tools/call",
			params: {
				name: "createDocument",
				arguments: {
					collection: "ledgers",
					locale: "en",
					data: { title: `Batched ${String(index)}` },
				},
			},
		}));

		const response = await mcpPost(booted, { key, body: messages });

		expect(response.status).toBe(400);
		expect(await response.json()).toEqual({
			jsonrpc: "2.0",
			id: null,
			error: {
				code: -32600,
				message: "Invalid request: a batch may hold at most 10 messages.",
			},
		});
		expect(
			await booted.payload.count({ collection: "ledgers" as never }),
		).toEqual(before);
	});

	it("answers a batch of 10 messages", async () => {
		const results = await mcp.batch(
			Array.from({ length: 10 }, () => ({ name: "listCapabilities" })),
		);

		expect(results.map((result) => result.isError)).toEqual(
			Array.from({ length: 10 }, () => false),
		);
	});

	const createLedger = (title: string, frozen: boolean) =>
		booted.payload.create({
			collection: "ledgers" as never,
			data: { title, frozen },
		});

	const retitle = (id: number | string, title: string) => ({
		name: "patchDocument",
		args: {
			collection: "ledgers",
			id,
			locale: "en",
			patches: [{ op: "replace", path: "/title", value: title }],
		},
	});

	it("keeps the first write of a batch when the second one fails", async () => {
		const open = await createLedger("Open before", false);
		const frozen = await createLedger("Frozen before", true);

		const results = await mcp.batch([
			retitle(open.id, "Open after"),
			retitle(frozen.id, "Frozen after"),
		]);

		expect(results.map((result) => result.isError)).toEqual([false, true]);
		expect(await draftTitle(frozen.id)).toBe("Frozen before");
		expect(await draftTitle(open.id)).toBe("Open after");
	});

	it("keeps the second write of a batch when the first one fails", async () => {
		const frozen = await createLedger("Frozen before", true);
		const open = await createLedger("Open before", false);

		const results = await mcp.batch([
			retitle(frozen.id, "Frozen after"),
			retitle(open.id, "Open after"),
		]);

		expect(results.map((result) => result.isError)).toEqual([true, false]);
		expect(await draftTitle(frozen.id)).toBe("Frozen before");
		expect(await draftTitle(open.id)).toBe("Open after");
	});

	it("lets a call see the write of the call before it", async () => {
		const ledger = await createLedger("Zero", false);

		const results = await mcp.batch([
			retitle(ledger.id, "One"),
			{
				name: "patchDocument",
				args: {
					collection: "ledgers",
					id: ledger.id,
					locale: "en",
					patches: [
						{ op: "test", path: "/title", value: "One" },
						{ op: "replace", path: "/title", value: "Two" },
					],
				},
			},
		]);

		expect(results.map((result) => result.isError)).toEqual([false, false]);
		expect(await draftTitle(ledger.id)).toBe("Two");
	});
});
