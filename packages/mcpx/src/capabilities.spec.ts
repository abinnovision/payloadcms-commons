import { describe, expect, it } from "vitest";

import {
	readableGlobalSlugs,
	readableSlugs,
	resolveCapabilities,
	writableGlobalSlugs,
	writableSlugs,
} from "./capabilities.js";

import type { NormalizedOptions } from "./options.js";

const options = {
	collections: [
		{ slug: "pages", read: true, write: true, fieldName: "pages" },
		{ slug: "my-tags", read: true, write: false, fieldName: "myTags" },
	],
	globals: [
		{
			slug: "site-settings",
			read: true,
			write: true,
			fieldName: "siteSettings",
		},
		{ slug: "banner", read: true, write: false, fieldName: "banner" },
	],
	tools: [{ name: "echo" }, { name: "other" }],
} as unknown as NormalizedOptions;

describe("resolveCapabilities", () => {
	it("ands the plugin config with the key checkboxes for globals", () => {
		const resolved = resolveCapabilities(options, {
			globals: {
				siteSettings: { read: true, write: true },
				banner: { read: true, write: true },
			},
		});

		expect(resolved.globals).toEqual({
			"site-settings": { read: true, write: true },
			banner: { read: true, write: false },
		});
		expect(readableGlobalSlugs(resolved)).toEqual(["site-settings", "banner"]);
		expect(writableGlobalSlugs(resolved)).toEqual(["site-settings"]);
	});

	it("closes every global on a key issued before globals existed", () => {
		/*
		 * Such a key document has no `globals` group at all, which is the shape
		 * every pre-existing key has after this feature ships.
		 */
		const resolved = resolveCapabilities(options, {
			collections: { pages: { read: true, write: true } },
		});

		expect(resolved.globals).toEqual({
			"site-settings": { read: false, write: false },
			banner: { read: false, write: false },
		});
		expect(readableGlobalSlugs(resolved)).toEqual([]);
		expect(writableGlobalSlugs(resolved)).toEqual([]);
	});

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
