import { describe, expect, it } from "vitest";

import { FLUE_ROUTES, routePath } from "./paths.js";

describe("routePath", () => {
	it("fills each parameter with its encoded value", () => {
		expect(routePath("chat", { agent: "editor" })).toBe("/chat/editor");
		expect(routePath("conversation", { thread: 42 })).toBe("/c/42");
		expect(routePath("conversationAbort", { thread: "a/b" })).toBe(
			"/c/a%2Fb/abort",
		);
	});

	it("returns a route without parameters as registered", () => {
		expect(routePath("exchange")).toBe(FLUE_ROUTES.exchange);
	});

	it("throws for a missing parameter", () => {
		expect(() => routePath("chat")).toThrow(/"agent"/);
	});
});
