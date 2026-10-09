import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMcpClient } from "./helpers/mcp.js";
import { bootPayload, seedKeysFor } from "./helpers/payload.js";

import type { Booted } from "./helpers/payload.js";

const FOLDERS = "payload-folders";

describe("folders: false", () => {
	let booted: Booted;
	let key: string;

	beforeAll(async () => {
		booted = await bootPayload({
			key: "mcpx-integration-folders-off",
			collections: [
				{
					slug: "docs",
					folders: true,
					fields: [{ name: "title", type: "text" }],
				},
			],
			plugin: { collections: { docs: true }, folders: false },
		});

		const { payload } = booted;
		const { keys } = await seedKeysFor(payload, {
			// The group does not exist on the key, so the folder grant is dropped.
			key: {
				collections: {
					docs: { read: true },
					payloadFolders: { read: true, write: true },
				},
			},
		});

		await payload.create({
			collection: FOLDERS as never,
			data: { name: "Blog" },
		});

		key = keys.key;
	});

	afterAll(async () => {
		await booted.payload.destroy();
	});

	it("refuses folders", async () => {
		const mcp = createMcpClient(booted, key);
		const capabilities = await mcp.call("listCapabilities");
		const found = await mcp.call("findDocuments", { collection: FOLDERS });

		expect(
			(capabilities.data["collections"] as { slug: string }[]).map(
				(entry) => entry.slug,
			),
		).toEqual(["docs"]);
		expect(found.isError || found.rpcError !== undefined).toBe(true);
		expect(found.text ?? found.rpcError?.message).not.toContain("Blog");
	});
});
