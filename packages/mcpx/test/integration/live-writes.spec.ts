import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMcpClient } from "./helpers/mcp.js";
import { bootPayload, seedKeysFor } from "./helpers/payload.js";

import type { McpClient } from "./helpers/mcp.js";
import type { Booted } from "./helpers/payload.js";

const CACHE_KEY = "mcpx-integration-live-writes";

describe("live writes", () => {
	let booted: Booted;
	let live: McpClient;
	let draftsOnly: McpClient;

	beforeAll(async () => {
		booted = await bootPayload({
			key: CACHE_KEY,
			plugin: {
				collections: {
					pages: { publish: false },
					tags: true,
				},
				globals: { banner: true },
			},
		});

		const { keys } = await seedKeysFor(booted.payload, {
			live: {
				collections: {
					pages: { read: true, write: true },
					tags: { read: true, write: true },
				},
				globals: { banner: { read: true, write: true } },
			},
			draftsOnly: { collections: { pages: { read: true, write: true } } },
		});

		live = createMcpClient(booted, keys.live);
		draftsOnly = createMcpClient(booted, keys.draftsOnly);
	});

	afterAll(async () => {
		await booted.payload.destroy();
	});

	const descriptionOf = async (name: string, mcp: McpClient): Promise<string> =>
		(await mcp.list()).find((tool) => tool.name === name)?.description ?? "";

	it("names the targets that write live in the write tool descriptions", async () => {
		const patch = await descriptionOf("patchDocument", live);
		const create = await descriptionOf("createDocument", live);

		expect(patch).toContain("Writes to tags, banner go live immediately.");
		expect(create).toContain("Writes to tags go live immediately.");
	});

	it("leaves the write tool descriptions draft-only for every other key", async () => {
		const descriptions = await Promise.all(
			["patchDocument", "createDocument"].map((name) =>
				descriptionOf(name, draftsOnly),
			),
		);

		for (const description of descriptions) {
			expect(description).toContain("Every write is saved as a draft.");
			expect(description).not.toContain("banner");
		}
	});

	it("writes a collection without drafts live, as the description says", async () => {
		const result = await live.call("createDocument", {
			collection: "tags",
			locale: "en",
			data: { name: "Live" },
		});

		expect(result.isError).toBe(false);

		const doc = await booted.payload.findByID({
			collection: "tags",
			id: result.data["id"] as number | string,
		});

		expect(doc).toMatchObject({ name: "Live" });
		expect(doc).not.toHaveProperty("_status");
	});
});
