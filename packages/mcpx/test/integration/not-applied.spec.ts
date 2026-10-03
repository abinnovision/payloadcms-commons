import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMcpClient } from "./helpers/mcp.js";
import { bootPayload, createKey, seedKeysFor } from "./helpers/payload.js";
import { KEEPER_EMAIL, ledgers, vaults } from "../fixtures/security.js";

import type { McpClient } from "./helpers/mcp.js";
import type { Booted } from "./helpers/payload.js";

const CACHE_KEY = "mcpx-integration-not-applied";

const SECRET = "stored ledger secret";

const CODE = "stored vault code";

describe("notApplied on a field closed to the key's user", () => {
	let booted: Booted;
	let mcp: McpClient;
	let keeper: McpClient;
	let visitor: McpClient;
	let ledgerId: number | string;

	beforeAll(async () => {
		booted = await bootPayload({
			key: CACHE_KEY,
			collections: [ledgers, vaults],
			plugin: {
				collections: {
					ledgers: { publish: false },
					vaults: { publish: false },
				},
			},
		});

		const capabilities = {
			collections: { vaults: { read: true, write: true } },
		};
		const { keys } = await seedKeysFor(booted.payload, {
			ledger: { collections: { ledgers: { read: true, write: true } } },
			visitor: capabilities,
		});
		const keeperUser = await booted.payload.create({
			collection: "users",
			data: { email: KEEPER_EMAIL, password: "keeper-secret" },
		});

		mcp = createMcpClient(booted, keys.ledger);
		visitor = createMcpClient(booted, keys.visitor);
		keeper = createMcpClient(
			booted,
			await createKey(booted.payload, {
				userId: keeperUser.id,
				label: "keeper",
				capabilities,
			}),
		);

		const ledger = await booted.payload.create({
			collection: "ledgers" as never,
			data: { title: "Ledger", secret: SECRET },
		});

		ledgerId = ledger.id;
	});

	afterAll(async () => {
		await booted.payload.destroy();
	});

	const stored = async (
		collection: string,
		id: number | string,
		field: string,
	): Promise<unknown> =>
		(
			(await booted.payload.findByID({
				collection: collection as never,
				id,
				draft: true,
				overrideAccess: true,
			})) as unknown as Record<string, unknown>
		)[field];

	const createVault = async (): Promise<number | string> =>
		(
			await booted.payload.create({
				collection: "vaults" as never,
				data: { title: "Vault", code: CODE },
			})
		).id;

	const patchCode = (client: McpClient, id: number | string, value: string) =>
		client.call("patchDocument", {
			collection: "vaults",
			id,
			locale: "en",
			patches: [{ op: "replace", path: "/code", value }],
		});

	it("answers the same for a matching and a wrong guess at an unreadable field", async () => {
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

		expect(await stored("ledgers", ledgerId, "secret")).toBe(SECRET);
		expect(right).toEqual(wrong);
		expect(right.rest["notApplied"]).toEqual(["/secret"]);
	});

	it("reports nothing for a field the user may read and update", async () => {
		const id = await createVault();
		const result = await patchCode(keeper, id, "new vault code");

		expect(result.isError).toBe(false);
		expect(result.data["notApplied"]).toBeUndefined();
		expect(await stored("vaults", id, "code")).toBe("new vault code");
	});

	it("reports a field the user may not touch for a matching and a wrong guess", async () => {
		const id = await createVault();

		for (const guess of [CODE, "a wrong guess"]) {
			const result = await patchCode(visitor, id, guess);

			expect(result.isError).toBe(false);
			expect(result.data["notApplied"]).toEqual(["/code"]);
			expect(await stored("vaults", id, "code")).toBe(CODE);
		}
	});
});
