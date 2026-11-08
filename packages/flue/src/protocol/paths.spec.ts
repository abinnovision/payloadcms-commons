import { describe, expect, it } from "vitest";

import { FLUE_ROUTES, routePath } from "./paths.js";

describe("routePath", () => {
	it("fills each parameter with its encoded value", () => {
		expect(routePath("chat", { agent: "editor" })).toBe("/chat/editor");
		expect(routePath("conversation", { thread: 42 })).toBe("/c/42");
		expect(routePath("conversationAbort", { thread: "a/b" })).toBe(
			"/c/a%2Fb/abort",
		);
		expect(
			routePath("conversationAttachment", {
				thread: 42,
				attachment: "att_image_sub_1_0",
			}),
		).toBe("/c/42/attachments/att_image_sub_1_0");
	});

	it("returns a route without parameters as registered", () => {
		expect(routePath("exchange")).toBe(FLUE_ROUTES.exchange);
	});

	it("extends the conversation route with the attachment path the Flue client resolves", () => {
		expect(
			routePath("conversationAttachment", { thread: 7, attachment: "att_x" }),
		).toBe(`${routePath("conversation", { thread: 7 })}/attachments/att_x`);
	});

	it("throws for a missing parameter", () => {
		expect(() => routePath("chat")).toThrow(/"agent"/);
	});
});
