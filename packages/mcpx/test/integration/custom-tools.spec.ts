import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { callTool, toolNames } from "./helpers/mcp.js";
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

		expect(await toolNames(booted.config, seeded.keys.full)).toContain("echo");
		expect(await toolNames(booted.config, without)).not.toContain("echo");
	});

	it("hands the handler the acting user and the key id", async () => {
		const result = await callTool(booted.config, seeded.keys.full, "echo", {
			message: "hi",
		});

		expect(result.isError).toBe(false);
		expect(result.data["message"]).toBe("hi");
		expect(result.data["userId"]).toBe(seeded.userId);
		expect(result.data["apiKeyId"]).toBeDefined();
	});
});
