import { describe, expect, it } from "vitest";

import {
	readableSlugs,
	resolveCapabilities,
	writableSlugs,
} from "./capabilities.js";

import type { NormalizedOptions } from "./options.js";

const options = {
	collections: [
		{ slug: "pages", read: true, write: true, fieldName: "pages" },
		{ slug: "my-tags", read: true, write: false, fieldName: "myTags" },
	],
	tools: [{ name: "echo" }, { name: "other" }],
} as unknown as NormalizedOptions;

describe("resolveCapabilities", () => {
	it("ands the plugin config with the key checkboxes", () => {
		const resolved = resolveCapabilities(options, {
			collections: {
				pages: { read: true, write: true },
				myTags: { read: true, write: true },
			},
			tools: { echo: true },
		});

		expect(resolved.collections).toEqual({
			pages: { read: true, write: true },
			"my-tags": { read: true, write: false },
		});
		expect(resolved.tools).toEqual({ echo: true, other: false });
		expect(readableSlugs(resolved)).toEqual(["pages", "my-tags"]);
		expect(writableSlugs(resolved)).toEqual(["pages"]);
	});

	it("treats a missing checkbox as refused", () => {
		const resolved = resolveCapabilities(options, {
			collections: { pages: { read: true } },
		});

		expect(resolved.collections["pages"]).toEqual({ read: true, write: false });
		expect(resolved.collections["my-tags"]).toEqual({
			read: false,
			write: false,
		});
		expect(resolved.tools).toEqual({ echo: false, other: false });
	});

	it("survives keys without any capabilities", () => {
		expect(readableSlugs(resolveCapabilities(options, undefined))).toEqual([]);
		expect(readableSlugs(resolveCapabilities(options, "garbage"))).toEqual([]);
	});

	it("ignores slugs the config does not expose", () => {
		const resolved = resolveCapabilities(options, {
			collections: { users: { read: true, write: true } },
		});

		expect(resolved.collections).not.toHaveProperty("users");
	});
});
