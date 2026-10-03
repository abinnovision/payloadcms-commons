import { inMemoryKVAdapter } from "payload";
import { describe, expect, it } from "vitest";

import { claimGrant, uploadKvSlug } from "./grant.js";
import { buildFixtureConfig } from "../../test/fixtures/config.js";

import type { Payload } from "payload";

describe("claimGrant", () => {
	// No database: a read would throw instead of resolving.
	const payload = { secret: "mcpx-test-secret", db: {} } as unknown as Payload;

	it.each(["", "short", `${"a".repeat(42)}!`, "a".repeat(44)])(
		"refuses the malformed id %j without a database read",
		async (grantId) => {
			await expect(
				claimGrant(payload, "payload-kv", grantId),
			).resolves.toBeUndefined();
		},
	);
});

describe("uploadKvSlug", () => {
	it("names the collection of Payload's database KV", async () => {
		expect(uploadKvSlug(await buildFixtureConfig())).toBe("payload-kv");
	});

	it("is undefined for a KV outside the database", async () => {
		expect(
			uploadKvSlug(await buildFixtureConfig({ kv: inMemoryKVAdapter() })),
		).toBeUndefined();
	});
});
