import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMcpClient } from "./helpers/mcp.js";
import { bootPayload, seedKeys } from "./helpers/payload.js";

import type { McpClient } from "./helpers/mcp.js";
import type { Booted } from "./helpers/payload.js";

const CACHE_KEY = "mcpx-integration-schema-errors";

describe("schema errors", () => {
	let booted: Booted;
	let mcp: McpClient;
	let postId: number | string;

	beforeAll(async () => {
		booted = await bootPayload({ key: CACHE_KEY });
		mcp = createMcpClient(booted, (await seedKeys(booted.payload)).keys.full);

		const post = await booted.payload.create({
			collection: "posts",
			draft: true,
			data: { title: "Schema errors" },
		});

		postId = post.id;
	});

	afterAll(async () => {
		await booted.payload.destroy();
	});

	/*
	 * Replaces the entry the plugin's schema walk reads with one it cannot
	 * walk. Payload reads its own reference to the collection config, so the
	 * document itself still loads and only the schema walk fails.
	 */
	const withUnreadableSchema = async <T>(
		slug: string,
		run: () => Promise<T>,
	): Promise<T> => {
		const { collections } = booted.payload.config;
		const index = collections.findIndex((entry) => entry.slug === slug);
		const original = collections[index]!;

		collections[index] = { ...original, flattenedFields: null as never };

		try {
			return await run();
		} finally {
			collections[index] = original;
		}
	};

	describe("describeSchema", () => {
		it("gives a path its own schema message without failing the others", async () => {
			const result = await mcp.call("describeSchema", {
				collection: "posts",
				paths: ["", "/nope"],
			});
			const [root, missing] = result.data as unknown as Record<
				string,
				unknown
			>[];

			expect(result.isError).toBe(false);
			expect(root).toHaveProperty("fields");
			expect(missing?.["schemaPath"]).toBe("/nope");
			expect(missing?.["error"]).toEqual(expect.stringContaining("/nope"));
		});

		it("reports any other failure as an internal error per path", async () => {
			const result = await withUnreadableSchema("posts", () =>
				mcp.call("describeSchema", {
					collection: "posts",
					paths: ["", "/title"],
				}),
			);

			expect(result.isError).toBe(false);
			expect(result.data).toEqual([
				{ error: "Internal error", schemaPath: "" },
				{ error: "Internal error", schemaPath: "/title" },
			]);
		});
	});

	describe("getDocument with outline", () => {
		it("returns a schema message for a path no field answers to", async () => {
			const result = await mcp.call("getDocument", {
				collection: "posts",
				id: postId,
				path: "/nope",
				outline: true,
			});

			expect(result.isError).toBe(true);
			expect(result.data["error"]).toEqual(expect.stringContaining("/nope"));
		});

		it("reports any other failure as an internal error", async () => {
			const result = await withUnreadableSchema("posts", () =>
				mcp.call("getDocument", {
					collection: "posts",
					id: postId,
					path: "/summary",
					outline: true,
				}),
			);

			expect(result.isError).toBe(true);
			expect(result.data).toEqual({ error: "Internal error" });
		});
	});
});
