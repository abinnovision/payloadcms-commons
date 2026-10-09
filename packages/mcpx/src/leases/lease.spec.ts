import { inMemoryKVAdapter } from "payload";
import { describe, expect, it } from "vitest";

import { leaseKvSlug } from "./lease.js";
import { buildFixtureConfig } from "../../test/fixtures/config.js";

describe("leaseKvSlug", () => {
	it("names the collection of Payload's database KV", async () => {
		expect(leaseKvSlug(await buildFixtureConfig())).toBe("payload-kv");
	});

	it("is undefined for a KV outside the database", async () => {
		expect(
			leaseKvSlug(await buildFixtureConfig({ kv: inMemoryKVAdapter() })),
		).toBeUndefined();
	});
});
