import { payloadMajor } from "@internal/test-utils/payload-major";
import { sqliteAdapter } from "@payloadcms/db-sqlite";
import * as payloadModule from "payload";
import { buildConfig, getPayload } from "payload";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMcpClient, responseText } from "./helpers/mcp.js";
import { bootPayload, seedKeysFor } from "./helpers/payload.js";
import { mcpxPlugin } from "../../src/index.js";

import type { Booted } from "./helpers/payload.js";
import type { McpxPluginOptions } from "../../src/index.js";
import type { CollectionConfig, Field } from "payload";

const isV4 = payloadMajor() === 4;

/*
 * Payload 3 adds its own folder collection where a collection has
 * `folders: true`. On Payload 4 a collection with `folders: true` is the
 * folder collection, and documents point at it through `createFolderField`.
 */
const FOLDERS = isV4 ? "folders" : "payload-folders";
const FOLDERS_FIELD = isV4 ? "folders" : "payloadFolders";
const FOLDER_FIELD = isV4 ? "_h_folders" : "folder";

// Payload 3 does not export it, so a named import would fail to link.
const { createFolderField } = payloadModule as unknown as {
	createFolderField: (options: { relationTo: string }) => Field;
};

// Fresh objects per boot: Payload 4 adds hierarchy fields to the config.
const collections = (): CollectionConfig[] =>
	isV4
		? [
				{
					slug: FOLDERS,
					folders: true,
					admin: { useAsTitle: "name" },
					fields: [{ name: "name", type: "text", required: true }],
				},
				{
					slug: "docs",
					fields: [
						{ name: "title", type: "text" },
						createFolderField({ relationTo: FOLDERS }),
					],
				},
			]
		: [
				{
					slug: "docs",
					folders: true,
					fields: [{ name: "title", type: "text" }],
				},
			];

describe("folder collection", () => {
	let booted: Booted;
	let key: string;
	let folderId: number | string;

	beforeAll(async () => {
		booted = await bootPayload({
			key: "mcpx-integration-folder-collection",
			collections: collections(),
			plugin: { collections: { [FOLDERS]: true, docs: true } },
		});

		const { payload } = booted;
		const { keys } = await seedKeysFor(payload, {
			key: {
				collections: {
					docs: { read: true, write: true },
					[FOLDERS_FIELD]: { read: true, write: true },
				},
			},
		});
		const folder = await payload.create({
			collection: FOLDERS as never,
			data: { name: "Blog" },
			overrideAccess: true,
		});

		key = keys.key;
		folderId = folder.id;
	});

	afterAll(async () => {
		await booted.payload.destroy();
	});

	it("exposes folders with the ordinary defaults and no delete", async () => {
		const mcp = createMcpClient(booted, key);
		const capabilities = await mcp.call("listCapabilities");

		expect(
			(capabilities.data["collections"] as { slug: string }[]).find(
				(entry) => entry.slug === FOLDERS,
			),
		).toMatchObject({ read: true, write: true, publish: false });
		expect(await mcp.names()).not.toContain("deleteDocument");
	});

	it("lists and reads folders", async () => {
		const mcp = createMcpClient(booted, key);
		const found = await mcp.call("findDocuments", { collection: FOLDERS });
		const read = await mcp.call("getDocument", {
			collection: FOLDERS,
			id: folderId,
		});

		expect(found.isError).toBe(false);
		expect(
			(found.data["docs"] as { name: string }[]).map((doc) => doc.name),
		).toEqual(["Blog"]);
		expect(read.isError).toBe(false);
		expect(responseText(read)).toContain("Blog");
	});

	it("creates and renames a folder", async () => {
		const mcp = createMcpClient(booted, key);
		const created = await mcp.call("createDocument", {
			collection: FOLDERS,
			locale: "en",
			data: { name: "Drafts" },
		});

		expect(created.isError).toBe(false);

		const id = created.data["id"] as number | string;
		const renamed = await mcp.call("patchDocument", {
			collection: FOLDERS,
			id,
			locale: "en",
			patches: [{ op: "replace", path: "/name", value: "Archive" }],
		});

		expect(renamed.isError).toBe(false);
		expect(
			await booted.payload.findByID({
				collection: FOLDERS as never,
				id,
				overrideAccess: true,
			}),
		).toMatchObject({ name: "Archive" });
	});

	it("sets the folder of an exposed document", async () => {
		const created = await createMcpClient(booted, key).call("createDocument", {
			collection: "docs",
			locale: "en",
			data: { title: "Filed", [FOLDER_FIELD]: folderId },
		});

		expect(created.isError).toBe(false);

		const doc = (await booted.payload.findByID({
			collection: "docs" as never,
			id: created.data["id"] as number | string,
			depth: 0,
			overrideAccess: true,
		})) as unknown as Record<string, unknown>;

		expect(doc[FOLDER_FIELD]).toBe(folderId);
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

describe("folder collection at startup", () => {
	// A minimal config: the shared fixtures do not survive a second boot.
	const boot = (
		key: string,
		extra: CollectionConfig[],
		exposed: McpxPluginOptions["collections"],
	) =>
		getPayload({
			key,
			config: buildConfig({
				secret: "mcpx-test-secret",
				db: sqliteAdapter({ client: { url: ":memory:" } }),
				collections: [{ slug: "users", auth: true, fields: [] }, ...extra],
				plugins: [mcpxPlugin({ collections: exposed })],
				typescript: { autoGenerate: false },
				graphQL: { disable: true },
			}),
		});

	it("refuses delete on the folder collection", async () => {
		await expect(
			boot("mcpx-integration-folder-collection-delete", collections(), {
				[FOLDERS]: { delete: true },
			}),
		).rejects.toThrow(/Remove delete\./);
	});

	it("refuses Payload's folder collection where no collection uses folders", async () => {
		await expect(
			boot("mcpx-integration-folder-collection-missing", [], {
				"payload-folders": true,
			}),
		).rejects.toThrow(/Folder collection "payload-folders" does not exist/);
	});
});
