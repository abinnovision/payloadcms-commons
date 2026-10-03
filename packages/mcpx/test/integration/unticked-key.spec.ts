import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMcpClient } from "./helpers/mcp.js";
import {
	bootPayload,
	createDraft,
	seedKeysFor,
	storedState,
} from "./helpers/payload.js";

import type { McpClient } from "./helpers/mcp.js";
import type { Booted } from "./helpers/payload.js";

const CACHE_KEY = "mcpx-integration-unticked-key";

describe("a key with nothing ticked", () => {
	let booted: Booted;
	let mcp: McpClient;
	let readOnly: McpClient;
	let pageId: number | string;

	beforeAll(async () => {
		booted = await bootPayload({
			key: CACHE_KEY,
			plugin: {
				collections: { pages: true, tags: true, snippets: true },
				globals: { "site-settings": true, banner: true },
			},
		});

		const { keys } = await seedKeysFor(booted.payload, {
			empty: {},
			readOnly: { collections: { pages: { read: true } } },
		});

		mcp = createMcpClient(booted, keys.empty);
		readOnly = createMcpClient(booted, keys.readOnly);

		const page = await createDraft<{ id: number | string }>(
			booted.payload,
			"pages",
			{ title: "Home", slug: "home" },
		);

		pageId = page.id;
	});

	afterAll(async () => {
		await booted.payload.destroy();
	});

	it("sees only listCapabilities although the config exposes everything", async () => {
		expect(await mcp.names()).toEqual(["listCapabilities"]);

		const capabilities = await mcp.call("listCapabilities");

		expect(capabilities.data["collections"]).toEqual([]);
	});

	it("offers no write tool to a key with only read ticked and refuses a patch", async () => {
		const tools = await readOnly.names();

		expect(tools).toContain("getDocument");
		expect(tools).not.toContain("patchDocument");
		expect(tools).not.toContain("createDocument");
		expect(tools).not.toContain("publishDocument");

		const before = await storedState(booted.payload, {
			collections: ["pages"],
		});
		const result = await readOnly.call("patchDocument", {
			collection: "pages",
			id: pageId,
			locale: "en",
			patches: [{ op: "replace", path: "/title", value: "Changed" }],
		});

		expect(result.isError).toBe(true);
		expect(
			await storedState(booted.payload, { collections: ["pages"] }),
		).toEqual(before);
	});
});
