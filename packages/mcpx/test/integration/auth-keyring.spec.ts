import { payloadMajor } from "@internal/test-utils/payload-major";
import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMcpClient } from "./helpers/mcp.js";
import { API_KEYS_SLUG, bootPayload, createKey } from "./helpers/payload.js";
import { hashApiKey } from "../../src/api-keys/key.js";

import type { Booted } from "./helpers/payload.js";

const PREVIOUS_SECRET = "mcpx-previous-secret";

// How Payload derives the HMAC key of a secret.
const legacyKeyOf = (secret: string): string =>
	createHash("sha256").update(secret).digest("hex").slice(0, 32);

describe("api key lookup across secrets", () => {
	let booted: Booted;
	let userId: number | string;

	beforeAll(async () => {
		booted = await bootPayload({
			key: "mcpx-integration-keyring",
			previousSecrets: [PREVIOUS_SECRET],
		});
		userId = (
			await booted.payload.create({
				collection: "users",
				data: { email: "keyring@example.com", password: "keyring-secret" },
				overrideAccess: true,
			})
		).id;
	});

	afterAll(async () => {
		await booted.payload.destroy();
	});

	const keyIndexedUnder = async (
		label: string,
		secret: string | undefined,
	): Promise<string> => {
		const key = await createKey(booted.payload, {
			userId,
			label,
			capabilities: { collections: { tags: { read: true } } },
		});

		if (secret !== undefined) {
			const { docs } = await booted.payload.find({
				collection: API_KEYS_SLUG as never,
				where: { label: { equals: label } },
				overrideAccess: true,
			});

			await booted.payload.db.updateOne({
				collection: API_KEYS_SLUG,
				id: docs[0]!.id,
				data: { apiKeyIndex: hashApiKey(legacyKeyOf(secret), key) },
				returning: false,
			});
		}

		return key;
	};

	it("resolves a key indexed under the active secret", async () => {
		const key = await keyIndexedUnder("active", undefined);

		expect((await createMcpClient(booted, key).rpc("tools/list")).status).toBe(
			200,
		);
	});

	it("resolves a key indexed under a previous secret only on Payload 4", async () => {
		const key = await keyIndexedUnder("previous", PREVIOUS_SECRET);

		// Payload 3 has no keyring and ignores `previousSecrets`.
		expect((await createMcpClient(booted, key).rpc("tools/list")).status).toBe(
			payloadMajor() === 4 ? 200 : 401,
		);
	});

	it("refuses a key indexed under an unknown secret", async () => {
		const key = await keyIndexedUnder("unknown", "mcpx-unknown-secret");

		expect((await createMcpClient(booted, key).rpc("tools/list")).status).toBe(
			401,
		);
	});
});
