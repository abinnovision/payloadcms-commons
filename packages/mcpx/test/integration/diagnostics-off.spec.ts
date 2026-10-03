import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createMcpClient } from "./helpers/mcp.js";
import {
	bootPayload,
	FULL_CAPABILITIES,
	seedKeysFor,
} from "./helpers/payload.js";

import type { Booted } from "./helpers/payload.js";

describe("diagnostics: false", () => {
	let booted: Booted;
	let key: string;

	beforeAll(async () => {
		booted = await bootPayload({
			key: "mcpx-integration-diagnostics-off",
			plugin: { diagnostics: false },
		});
		key = (await seedKeysFor(booted.payload, { off: FULL_CAPABILITIES })).keys
			.off;
	});

	afterAll(async () => {
		await booted.payload.destroy();
	});

	it("leaves the server block out of listCapabilities", async () => {
		const { data } = await createMcpClient(booted, key).call(
			"listCapabilities",
		);

		expect(data).not.toHaveProperty("server");
	});
});
