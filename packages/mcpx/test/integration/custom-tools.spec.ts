import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { collectionEnumOf, createMcpClient } from "./helpers/mcp.js";
import {
	bootPayload,
	createKey,
	FULL_CAPABILITIES,
	seedKeys,
} from "./helpers/payload.js";

import type { Booted, Seeded } from "./helpers/payload.js";

describe("custom tools", () => {
	let booted: Booted;
	let seeded: Seeded;

	beforeAll(async () => {
		booted = await bootPayload();
		seeded = await seedKeys(booted.payload);
	});

	afterAll(async () => {
		await booted.payload.destroy();
	});

	it("registers the tool only when its checkbox is on", async () => {
		const without = await createKey(booted.payload, {
			userId: seeded.userId,
			label: "no-echo",
			capabilities: { ...FULL_CAPABILITIES, tools: {} },
		});

		expect(await createMcpClient(booted, seeded.keys.full).names()).toContain(
			"echo",
		);
		expect(await createMcpClient(booted, without).names()).not.toContain(
			"echo",
		);
	});

	it("hands the handler the acting user and the key id", async () => {
		const result = await createMcpClient(booted, seeded.keys.full).call(
			"echo",
			{ message: "hi" },
		);

		expect(result.isError).toBe(false);
		expect(result.data["message"]).toBe("hi");
		expect(result.data["userId"]).toBe(seeded.userId);
		expect(result.data["apiKeyId"]).toBeDefined();
	});

	it("narrows a scope-built enum to what the key may read", async () => {
		const full = await createMcpClient(booted, seeded.keys.full).list();

		expect(
			collectionEnumOf(full.find((tool) => tool.name === "whichCollection")),
		).toEqual(["pages", "posts", "tags"]);
		/*
		 * The tags-only key has no `whichCollection` checkbox, so the tool is
		 * absent rather than narrowed: the checkbox and the scope both gate it.
		 */
		expect(
			await createMcpClient(booted, seeded.keys.tagsOnly).names(),
		).not.toContain("whichCollection");
	});

	it("rejects an unknown argument by name", async () => {
		const result = await createMcpClient(booted, seeded.keys.full).call(
			"echo",
			{ message: "hi", mesage: "typo" },
		);

		expect(result.rpcError?.message ?? result.text).toMatch(/mesage/);
	});
});
