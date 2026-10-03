import { rm } from "node:fs/promises";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { collectionEnumOf, createMcpClient } from "./helpers/mcp.js";
import { bootPayload, createMedia, seedKeysFor } from "./helpers/payload.js";
import { MEDIA_DIR } from "../fixtures/collections.js";

import type { McpClient } from "./helpers/mcp.js";
import type { Booted } from "./helpers/payload.js";

const CACHE_KEY = "mcpx-uploads";

describe("upload collections", () => {
	let booted: Booted;
	let mcp: McpClient;
	let mediaId: number | string;

	beforeAll(async () => {
		booted = await bootPayload({
			key: CACHE_KEY,
			plugin: {
				collections: {
					pages: { publish: false },
					media: true,
				},
			},
		});

		const { keys } = await seedKeysFor(booted.payload, {
			media: {
				collections: {
					pages: { read: true, write: true },
					media: { read: true, write: true, publish: true },
				},
			},
		});

		mcp = createMcpClient(booted, keys.media);

		mediaId = (await createMedia(booted.payload, "Original")).id;
	});

	afterAll(async () => {
		await booted.payload.destroy();
		await rm(MEDIA_DIR, { recursive: true, force: true });
	});

	/**
	 * Drafts are where an MCP write lands, so that is what is read back.
	 */
	const readMedia = () =>
		booted.payload.findByID({
			collection: "media" as never,
			id: mediaId,
			draft: true,
			overrideAccess: true,
		}) as unknown as Promise<Record<string, unknown>>;

	it("describes only the fields the collection declares itself", async () => {
		const result = await mcp.call("describeSchema", { collection: "media" });
		const [root] = result.data as unknown as {
			fields: { path: string }[];
		}[];

		expect(root?.fields.map((field) => field.path)).toEqual([
			"/alt",
			"/credit",
		]);
	});

	it("reports media as writable but not creatable", async () => {
		const result = await mcp.call("listCapabilities", {});
		const collections = result.data["collections"] as Record<string, unknown>[];

		expect(collections).toEqual([
			expect.objectContaining({ slug: "pages", write: true, create: true }),
			expect.objectContaining({ slug: "media", write: true, create: false }),
		]);
	});

	it("offers media to patchDocument but not to createDocument", async () => {
		const tools = await mcp.list();
		const find = (name: string) => tools.find((tool) => tool.name === name);

		expect(collectionEnumOf(find("patchDocument"))).toContain("media");
		expect(collectionEnumOf(find("createDocument"))).not.toContain("media");
		expect(find("createDocument")?.description).toContain(
			"Documents in media are files and cannot be created here.",
		);
	});

	it("patches a field and leaves the file untouched", async () => {
		const before = await readMedia();

		const result = await mcp.call("patchDocument", {
			collection: "media",
			id: mediaId,
			locale: "en",
			patches: [{ op: "replace", path: "/alt", value: "Patched" }],
		});

		expect(result.isError).toBe(false);

		const after = await readMedia();

		expect(after["alt"]).toBe("Patched");
		expect(after["filename"]).toBe(before["filename"]);
		expect(after["mimeType"]).toBe(before["mimeType"]);
		expect(after["filesize"]).toBe(before["filesize"]);
		expect(after["url"]).toBe(before["url"]);
	});

	/*
	 * `focalX` is the one upload base field Payload leaves writable, so this
	 * fails the moment the schema walk stops treating `admin.hidden` as hidden.
	 */
	it("refuses a patch aimed at an upload base field", async () => {
		const result = await mcp.call("patchDocument", {
			collection: "media",
			id: mediaId,
			locale: "en",
			patches: [{ op: "replace", path: "/focalX", value: 10 }],
		});

		expect(result.isError).toBe(true);
		expect(JSON.stringify(result.data["problems"])).toContain("/focalX");
		expect((await readMedia())["focalX"]).not.toBe(10);
	});

	it("validates and publishes the draft it patched", async () => {
		const validated = await mcp.call("validateDocument", {
			collection: "media",
			id: mediaId,
			locale: "en",
		});

		expect(validated.isError).toBe(false);
		expect(validated.data["publishBlockers"]).toEqual([]);

		const published = await mcp.call("publishDocument", {
			collection: "media",
			id: mediaId,
		});

		expect(published.isError).toBe(false);
		expect((await readMedia())["_status"]).toBe("published");
	});
});
