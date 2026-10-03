import { describe, expect, it } from "vitest";

import { isMcpxRequest } from "./request.js";

import type { PayloadRequest } from "payload";

const requestWith = (context: Record<string, unknown>): PayloadRequest =>
	({ context }) as unknown as PayloadRequest;

describe("isMcpxRequest", () => {
	it("recognises the marker the endpoint stamps", () => {
		expect(
			isMcpxRequest(
				requestWith({
					mcpx: {
						apiKeyId: "key",
						capabilities: { collections: {}, globals: {}, tools: {} },
					},
				}),
			),
		).toBe(true);
	});

	it("ignores every other request", () => {
		expect(isMcpxRequest(requestWith({}))).toBe(false);
	});
});
