import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { callTool } from "./helpers/mcp.js";
import { bootPayload, createKey } from "./helpers/payload.js";
import { ledgers } from "../fixtures/security.js";

import type { Booted } from "./helpers/payload.js";

const CACHE_KEY = "mcpx-integration-not-applied";

const SECRET = "stored ledger secret";

describe("notApplied on a field closed to the key's user", () => {
	let booted: Booted;
	let key: string;

	beforeAll(async () => {
		booted = await bootPayload({
			key: CACHE_KEY,
			collections: [ledgers],
			plugin: { collections: { ledgers: { read: true, write: "draft" } } },
		});

		const user = await booted.payload.create({
			collection: "users",
			data: { email: "ledger@example.com", password: "ledger-secret" },
		});

		key = await createKey(booted.payload, {
			userId: user.id,
			label: "ledger",
			capabilities: { collections: { ledgers: { read: true, write: true } } },
		});
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
			const ledger = await booted.payload.create({
				collection: "ledgers" as never,
				data: { title: "Ledger", secret: SECRET },
			});

			const patch = async (value: string) => {
				const result = await callTool(
					booted.config,
					key,
					"patchDocument",
					{
						collection: "ledgers",
						id: ledger.id,
						locale: "en",
						patches: [{ op: "replace", path: "/secret", value }],
					},
					CACHE_KEY,
				);
				const { updatedAt: _updatedAt, ...rest } = result.data;

				return { isError: result.isError, rest };
			};

			const right = await patch(SECRET);
			const wrong = await patch("a wrong guess");

			expect(await storedSecret(ledger.id)).toBe(SECRET);
			expect(right).toEqual(wrong);
		},
	);
});
