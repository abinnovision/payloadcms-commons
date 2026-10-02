import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMcpClient } from "./helpers/mcp.js";
import { bootPayload, seedKeysFor } from "./helpers/payload.js";
import { ledgers } from "../fixtures/security.js";

import type { McpClient } from "./helpers/mcp.js";
import type { Booted } from "./helpers/payload.js";

const CACHE_KEY = "mcpx-integration-not-applied";

const SECRET = "stored ledger secret";

describe("notApplied on a field closed to the key's user", () => {
	let booted: Booted;
	let mcp: McpClient;
	let ledgerId: number | string;

	beforeAll(async () => {
		booted = await bootPayload({
			key: CACHE_KEY,
			collections: [ledgers],
			plugin: { collections: { ledgers: { read: true, write: "draft" } } },
		});

		const { keys } = await seedKeysFor(booted.payload, {
			ledger: { collections: { ledgers: { read: true, write: true } } },
		});

		mcp = createMcpClient(booted, keys.ledger);

		const ledger = await booted.payload.create({
			collection: "ledgers" as never,
			data: { title: "Ledger", secret: SECRET },
		});

		ledgerId = ledger.id;
	});

	afterAll(async () => {
		await booted.payload.destroy();
	});

	const storedSecret = async (id: number | string): Promise<unknown> =>
		(
			(await booted.payload.findByID({
				collection: "ledgers" as never,
				id,
				draft: true,
				overrideAccess: true,
			})) as unknown as { secret?: unknown }
		).secret;

	it.fails(
		"tells whether a guess equals the stored value of an unreadable field",
		async () => {
			const patch = async (value: string) => {
				const result = await mcp.call("patchDocument", {
					collection: "ledgers",
					id: ledgerId,
					locale: "en",
					patches: [{ op: "replace", path: "/secret", value }],
				});
				const { updatedAt: _updatedAt, ...rest } = result.data;

				return { isError: result.isError, rest };
			};

			const right = await patch(SECRET);
			const wrong = await patch("a wrong guess");

			expect(await storedSecret(ledgerId)).toBe(SECRET);
			expect(right).toEqual(wrong);
		},
	);
});
