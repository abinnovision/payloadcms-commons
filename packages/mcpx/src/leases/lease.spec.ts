import { inMemoryKVAdapter } from "payload";
import { describe, expect, it } from "vitest";

import { leaseKvSlug, leasePrefixes } from "./lease.js";
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

describe("leasePrefixes", () => {
	it("keys a key principal by its id", () => {
		expect(leasePrefixes("confirmation", "42")).toEqual({
			prefix: "mcpx-confirmation:42:",
			usedPrefix: "mcpx-confirmation-used:42:",
		});
	});

	it("keys a strategy principal by its full name", () => {
		expect(leasePrefixes("grant", "agent:7")).toEqual({
			prefix: "mcpx-grant:agent:7:",
			usedPrefix: "mcpx-grant-used:agent:7:",
		});
	});
});
