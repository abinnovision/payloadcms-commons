import { describe, expect, it } from "vitest";

import {
	adminMessage,
	isAdminMessage,
	isPreviewMessage,
	previewMessage,
	VIEWFINDER_PROTOCOL_VERSION,
	VIEWFINDER_SOURCE,
} from "./protocol.js";

describe("message construction round-trips through its own guard", () => {
	it("accepts every preview message", () => {
		expect(isPreviewMessage(previewMessage.ready())).toBe(true);
		expect(isPreviewMessage(previewMessage.leave())).toBe(true);
		expect(isPreviewMessage(previewMessage.hover({ id: "a" }))).toBe(true);
		expect(
			isPreviewMessage(previewMessage.select({ id: "a", field: "heading" })),
		).toBe(true);
	});

	it("accepts every admin message", () => {
		expect(isAdminMessage(adminMessage.clear())).toBe(true);
		expect(isAdminMessage(adminMessage.highlight({ id: "a" }))).toBe(true);
		expect(isAdminMessage(adminMessage.scrollTo({ id: "a" }))).toBe(true);
	});
});

describe("the guards reject anything else on the channel", () => {
	it("rejects non-objects", () => {
		for (const value of [null, undefined, "ready", 1, []]) {
			expect(isPreviewMessage(value)).toBe(false);
		}
	});

	it("rejects a foreign source", () => {
		expect(
			isPreviewMessage({ ...previewMessage.ready(), source: "webpack" }),
		).toBe(false);
	});

	it("rejects a mismatched protocol version", () => {
		expect(
			isPreviewMessage({
				...previewMessage.ready(),
				version: VIEWFINDER_PROTOCOL_VERSION + 1,
			}),
		).toBe(false);
	});

	it("rejects an addressed type with no usable address", () => {
		const base = {
			source: VIEWFINDER_SOURCE,
			version: VIEWFINDER_PROTOCOL_VERSION,
		};
		expect(isPreviewMessage({ ...base, type: "hover" })).toBe(false);
		expect(isPreviewMessage({ ...base, type: "hover", address: {} })).toBe(
			false,
		);
		expect(
			isPreviewMessage({ ...base, type: "hover", address: { id: "" } }),
		).toBe(false);
		expect(
			isPreviewMessage({
				...base,
				type: "hover",
				address: { id: "a", field: 1 },
			}),
		).toBe(false);
	});

	it("keeps the two directions disjoint", () => {
		expect(isAdminMessage(previewMessage.hover({ id: "a" }))).toBe(false);
		expect(isPreviewMessage(adminMessage.highlight({ id: "a" }))).toBe(false);
	});
});
