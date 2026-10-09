import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMcpClient, responseText } from "./helpers/mcp.js";
import { bootPayload, seedKeysFor } from "./helpers/payload.js";

import type { Booted } from "./helpers/payload.js";

const FOLDERS = "payload-folders";

describe("folders by default", () => {
	let booted: Booted;
	let key: string;
	let folderId: number | string;

	beforeAll(async () => {
		booted = await bootPayload({
			key: "mcpx-integration-folders",
			collections: [
				{
					slug: "docs",
					folders: true,
					fields: [{ name: "title", type: "text" }],
				},
			],
			plugin: { collections: { docs: true } },
		});

		const { payload } = booted;
		const { keys } = await seedKeysFor(payload, {
			key: {
				collections: {
					docs: { read: true, write: true },
					payloadFolders: { read: true, write: true },
				},
			},
		});
		const folder = await payload.create({
			collection: FOLDERS as never,
			data: { name: "Blog" },
		});

		key = keys.key;
		folderId = folder.id;
	});

	afterAll(async () => {
		await booted.payload.destroy();
	});

	it("lists folders read-only", async () => {
		const mcp = createMcpClient(booted, key);
		const capabilities = await mcp.call("listCapabilities");
		const found = await mcp.call("findDocuments", { collection: FOLDERS });
		const created = await mcp.call("createDocument", {
			collection: FOLDERS,
			data: { name: "Drafts" },
		});

		expect(
			(capabilities.data["collections"] as { slug: string }[]).find(
				(entry) => entry.slug === FOLDERS,
			),
		).toMatchObject({ read: true, write: false });
		expect(found.isError).toBe(false);
		expect(
			(found.data["docs"] as { name: string }[]).map((doc) => doc.name),
		).toEqual(["Blog"]);
		expect(created.isError || created.rpcError !== undefined).toBe(true);
	});

	it("sets the folder of an exposed document", async () => {
		const created = await createMcpClient(booted, key).call("createDocument", {
			collection: "docs",
			locale: "en",
			data: { title: "Filed", folder: folderId },
		});

		expect(created.isError).toBe(false);

		const doc = (await booted.payload.findByID({
			collection: "docs" as never,
			id: created.data["id"] as number | string,
			depth: 0,
		})) as unknown as { folder: unknown };

		expect(doc.folder).toBe(folderId);
	});

	it("hides documentsAndFolders", async () => {
		const mcp = createMcpClient(booted, key);
		const results = [
			await mcp.call("getDocument", {
				collection: FOLDERS,
				id: folderId,
				depth: 1,
			}),
			await mcp.call("findDocuments", { collection: FOLDERS, depth: 1 }),
		];

		for (const result of results) {
			expect(result.isError).toBe(false);
			expect(responseText(result)).not.toContain("documentsAndFolders");
		}
	});
});
