import { withMcpxAuth } from "@abinnovision/payloadcms-mcpx";
import { describe, expect, it } from "vitest";

import { createTokenStrategy, flueTokenThread } from "./strategy.js";

import type { NormalizedOptions } from "../options.js";
import type { Payload, PayloadRequest } from "payload";

const settings = {
	agents: [{ slug: "editor", capabilities: {} }],
	mcpx: { userCollection: "users" },
} as unknown as Pick<NormalizedOptions, "agents" | "mcpx">;

// A Payload whose every property access fails, so any read shows up.
const untouchable = new Proxy(
	{},
	{
		get: () => {
			throw new Error("The strategy read Payload.");
		},
	},
) as Payload;

describe("createTokenStrategy", () => {
	const { authenticate } = createTokenStrategy(settings);

	it.each([
		["no header", undefined],
		["a JWT", "JWT abc"],
		["an mcpx API key", "Bearer 2f0c9a7e-key"],
		["the bare prefix", "Bearer flue_"],
		["a token shape flue does not mint", "Bearer flue_short"],
	])("ignores %s without reading Payload", async (_label, header) => {
		await expect(
			authenticate({
				headers: new Headers(header ? { authorization: header } : {}),
				payload: untouchable,
			}),
		).resolves.toEqual({ user: null });
	});
});

describe("flueTokenThread", () => {
	const user = { id: 1, collection: "users" };
	const requestAs = (value: object) =>
		({ user: value }) as unknown as Pick<PayloadRequest, "user">;

	it("reads the thread of a token request", () => {
		expect(
			flueTokenThread(
				requestAs(
					withMcpxAuth(
						{ ...user, _strategy: "flue-token" },
						{ principal: "flue-thread:42", capabilities: {} },
					),
				),
			),
		).toBe("42");
	});

	it("finds none for another strategy or a session", () => {
		expect(
			flueTokenThread(
				requestAs(
					withMcpxAuth(
						{ ...user, _strategy: "other" },
						{ principal: "flue-thread:42", capabilities: {} },
					),
				),
			),
		).toBeUndefined();
		expect(
			flueTokenThread(requestAs({ ...user, _strategy: "local-jwt" })),
		).toBeUndefined();
	});
});
