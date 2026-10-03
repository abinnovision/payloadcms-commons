import { inMemoryKVAdapter } from "payload";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMcpClient } from "./helpers/mcp.js";
import {
	bootPayload,
	PIXEL,
	seedKeysFor,
	storedState,
} from "./helpers/payload.js";

import type { McpClient } from "./helpers/mcp.js";
import type { Booted } from "./helpers/payload.js";

const CACHE_KEY = "mcpx-uploads-memory-kv";

/*
 * A grant is claimed through a unique key in the database, which a KV outside
 * it cannot offer.
 */
describe("uploads with a KV outside the database", () => {
	let booted: Booted;
	let mcp: McpClient;

	beforeAll(async () => {
		booted = await bootPayload({
			key: CACHE_KEY,
			kv: inMemoryKVAdapter(),
			plugin: { collections: { pages: { publish: false }, media: true } },
		});

		const { keys } = await seedKeysFor(booted.payload, {
			editor: {
				collections: {
					pages: { read: true, write: true },
					media: { read: true, write: true },
				},
			},
		});

		mcp = createMcpClient(booted, keys.editor);
	});

	afterAll(async () => {
		await booted.payload.destroy();
	});

	it("offers no file or download argument", async () => {
		const properties = (await mcp.list()).flatMap((tool) =>
			Object.keys(tool.inputSchema["properties"] ?? {}),
		);

		expect(properties).not.toContain("file");
		expect(properties).not.toContain("download");
	});

	it("refuses a create with a file and writes nothing", async () => {
		const before = await storedState(booted.payload, {
			collections: ["media"],
		});
		const result = await mcp.call("createDocument", {
			collection: "media",
			locale: "en",
			data: { alt: "Off" },
			file: {
				filename: "pixel.png",
				mimeType: "image/png",
				size: PIXEL.length,
			},
		});

		expect(result.isError).toBe(true);
		expect(
			await storedState(booted.payload, { collections: ["media"] }),
		).toEqual(before);
	});
});
