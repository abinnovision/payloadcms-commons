import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootPayload, USER } from "./helpers/payload.js";
import { createMcpxClient } from "../../src/local.js";

import type { Booted } from "./helpers/payload.js";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { TypedUser } from "payload";

const CACHE_KEY = "mcpx-integration-local-client";

describe("createMcpxClient", () => {
	let booted: Booted;
	let user: TypedUser;
	let client: Client;

	const call = async (
		name: string,
		args: Record<string, unknown>,
	): Promise<CallToolResult> =>
		(await client.callTool({ name, arguments: args })) as CallToolResult;

	const textOf = (result: CallToolResult): string => {
		const [first] = result.content;

		return first?.type === "text" ? first.text : "";
	};

	const names = async (): Promise<string[]> =>
		(await client.listTools()).tools.map((tool) => tool.name);

	beforeAll(async () => {
		booted = await bootPayload({ key: CACHE_KEY });

		const created = await booted.payload.create({
			collection: "users",
			data: USER,
		});

		user = { ...created, collection: "users" };
		client = await createMcpxClient(booted.payload, {
			user,
			capabilities: {
				collections: {
					posts: { read: true, write: true, publish: true },
					tags: { read: true, write: true },
					notes: { read: true },
				},
				tools: { echo: true },
			},
		});
	});

	afterAll(async () => {
		await client.close();
		await booted.payload.destroy();
	});

	it("lists only the tools the capabilities allow", async () => {
		const listed = await names();

		expect(listed).toEqual(
			expect.arrayContaining(["getDocument", "patchDocument", "echo"]),
		);
		expect(listed).not.toContain("deleteDocument");
		expect(listed).not.toContain("runConfirmed");
		expect(listed).not.toContain("whichCollection");
	});

	it("ignores a capability the config does not expose", async () => {
		// The config turns off publish on posts and write on tags, and does not expose notes.
		expect(await names()).not.toContain("publishDocument");

		const created = await call("createDocument", {
			collection: "tags",
			locale: "en",
			data: { name: "Nope" },
		});

		expect(created.isError).toBe(true);

		const notes = await call("findDocuments", { collection: "notes" });

		expect(notes.isError).toBe(true);
	});

	it("acts as the user without a key", async () => {
		const result = await call("echo", { message: "hi" });

		expect(JSON.parse(textOf(result))).toEqual({
			message: "hi",
			userId: user.id,
		});
	});

	it("reads a document", async () => {
		const post = await booted.payload.create({
			collection: "posts",
			locale: "en",
			data: { title: "Readable" },
		});
		const result = await call("getDocument", {
			collection: "posts",
			id: post.id,
			locale: "en",
		});

		expect(result.isError).not.toBe(true);
		expect(textOf(result)).toContain("Readable");
	});

	it("saves a patch as a draft and leaves the published version", async () => {
		const post = await booted.payload.create({
			collection: "posts",
			locale: "en",
			data: { title: "Published", _status: "published" },
		});
		const result = await call("patchDocument", {
			collection: "posts",
			id: post.id,
			locale: "en",
			patches: [{ op: "replace", path: "/title", value: "Drafted" }],
		});

		expect(result.isError).not.toBe(true);

		const read = (draft: boolean) =>
			booted.payload.findByID({
				collection: "posts",
				id: post.id,
				locale: "en",
				draft,
			});

		expect((await read(true))["title"]).toBe("Drafted");
		expect((await read(false))["title"]).toBe("Published");
	});

	it("rejects an unknown argument by name", async () => {
		const result = await call("echo", { message: "hi", mesage: "typo" });

		expect(result.isError).toBe(true);
		expect(textOf(result)).toMatch(/mesage/);
	});

	it("refuses a user outside the user collection", async () => {
		await expect(
			createMcpxClient(booted.payload, {
				user: { id: 1, collection: "posts" },
				capabilities: {},
			}),
		).rejects.toThrow(/"users" collection/);
	});
});
