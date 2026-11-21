import { describe, expect, it } from "vitest";

import { defaultDeliver } from "./attachments.js";

const MIB = 1024 * 1024;

describe("defaultDeliver", () => {
	it.each([
		["image/png", 3.75 * MIB, "attach"],
		["image/webp", 3.75 * MIB + 1, "reference"],
		["application/pdf", 5 * MIB, "attach"],
		["application/pdf", 5 * MIB + 1, "reference"],
		["text/csv", 10, "reference"],
		["image/svg+xml", 10, "reference"],
	] as const)("delivers %s of %i bytes as %s", (mimeType, size, delivery) => {
		expect(defaultDeliver({ mimeType, size, agent: "editor" })).toBe(delivery);
	});
});
