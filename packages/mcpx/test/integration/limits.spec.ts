import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMcpClient, mcpPost } from "./helpers/mcp.js";
import {
	bootPayload,
	FULL_CAPABILITIES,
	seedKeysFor,
} from "./helpers/payload.js";

import type { McpClient } from "./helpers/mcp.js";
import type { Booted } from "./helpers/payload.js";

const CACHE_KEY = "mcpx-integration-limits";

const BODY_LIMIT = 4 * 1024 * 1024;

const CREATE = JSON.stringify({
	jsonrpc: "2.0",
	id: 1,
	method: "tools/call",
	params: {
		name: "createDocument",
		arguments: { collection: "posts", locale: "en", data: { title: "Big" } },
	},
});

/**
 * The create call padded with trailing whitespace to exactly `size` bytes.
 */
const createOfSize = (size: number): string =>
	CREATE + " ".repeat(size - CREATE.length);

describe("endpoint limits", () => {
	let booted: Booted;
	let key: string;
	let mcp: McpClient;
	let postId: number | string;

	beforeAll(async () => {
		booted = await bootPayload({ key: CACHE_KEY });

		key = (await seedKeysFor(booted.payload, { limits: FULL_CAPABILITIES }))
			.keys.limits;
		mcp = createMcpClient(booted, key);

		const post = await booted.payload.create({
			collection: "posts",
			locale: "en",
			draft: true,
			data: { title: "Limits" },
		});

		postId = post.id;
	});

	afterAll(async () => {
		await booted.payload.destroy();
	});

	const postCount = async (): Promise<number> =>
		(await booted.payload.count({ collection: "posts" })).totalDocs;

	const stored = async (): Promise<unknown> =>
		await booted.payload.findByID({
			collection: "posts",
			id: postId,
			draft: true,
			locale: "all",
			overrideAccess: true,
		});

	const expectTooLarge = async (response: Response): Promise<void> => {
		expect(response.status).toBe(413);
		expect(await response.json()).toEqual({
			jsonrpc: "2.0",
			id: null,
			error: {
				code: -32000,
				message: "Request body too large: the limit is 4 MB.",
			},
		});
	};

	it("refuses a declared Content-Length over 4 MB and creates nothing", async () => {
		const before = await postCount();

		const response = await mcpPost(booted, {
			key,
			rawBody: CREATE,
			headers: { "content-length": String(BODY_LIMIT + 1) },
		});

		await expectTooLarge(response);
		expect(await postCount()).toBe(before);
	});

	it("refuses a body over 4 MB and creates nothing", async () => {
		const before = await postCount();

		const response = await mcpPost(booted, {
			key,
			rawBody: createOfSize(BODY_LIMIT + 1),
		});

		await expectTooLarge(response);
		expect(await postCount()).toBe(before);
	});

	it("stops reading a streamed body once it passes 4 MB and creates nothing", async () => {
		const before = await postCount();
		const chunk = new TextEncoder().encode(" ".repeat(64 * 1024));
		const total = 2 * BODY_LIMIT;
		let sent = 0;

		const stream = new ReadableStream<Uint8Array>({
			start: (controller) => {
				const head = new TextEncoder().encode(CREATE);

				sent += head.byteLength;
				controller.enqueue(head);
			},
			pull: (controller) => {
				if (sent >= total) {
					controller.close();

					return;
				}

				sent += chunk.byteLength;
				controller.enqueue(chunk);
			},
		});

		const response = await mcpPost(booted, {
			key,
			rawBody: stream,
		});

		await expectTooLarge(response);
		expect(sent).toBeLessThan(total);
		expect(await postCount()).toBe(before);
	});

	it("accepts a body of exactly 4 MB", async () => {
		const before = await postCount();

		const response = await mcpPost(booted, {
			key,
			rawBody: createOfSize(BODY_LIMIT),
		});
		const body = (await response.json()) as { result?: { isError?: boolean } };

		expect(response.status).toBe(200);
		expect(body.result?.isError).toBeUndefined();
		expect(await postCount()).toBe(before + 1);
	});

	it("refuses more than 500 patches and changes nothing", async () => {
		const before = await stored();

		const result = await mcp.call("patchDocument", {
			collection: "posts",
			id: postId,
			locale: "en",
			patches: Array.from({ length: 501 }, () => ({
				op: "replace",
				path: "/title",
				value: "Too many",
			})),
		});

		expect(result.isError).toBe(true);
		expect(result.text).toContain("500");
		expect(await stored()).toEqual(before);
	});

	it("applies 500 patches", async () => {
		const result = await mcp.call("patchDocument", {
			collection: "posts",
			id: postId,
			locale: "en",
			patches: Array.from({ length: 500 }, (_, index) => ({
				op: "replace",
				path: "/title",
				value: `Patch ${String(index)}`,
			})),
		});

		expect(result.isError).toBe(false);
		expect(((await stored()) as { title?: unknown }).title).toBe("Patch 499");
	});

	it("refuses more than 400 describeSchema paths and changes nothing", async () => {
		const before = await stored();

		const result = await mcp.call("describeSchema", {
			collection: "posts",
			paths: Array.from({ length: 401 }, () => ""),
		});

		expect(result.isError).toBe(true);
		expect(result.text).toContain("400");
		expect(await stored()).toEqual(before);
	});

	it("describes 400 paths", async () => {
		const result = await mcp.call("describeSchema", {
			collection: "posts",
			paths: Array.from({ length: 400 }, () => ""),
		});

		// The node vocabulary of the rich text fields follows the described nodes.
		const nodes = result.data as unknown as Record<string, unknown>[];

		expect(result.isError).toBe(false);
		expect(nodes.filter((node) => "schemaPath" in node)).toHaveLength(400);
	});
});
