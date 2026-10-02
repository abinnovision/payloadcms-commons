import { describe, expect, it } from "vitest";

import { canCreate, resolveCapabilities, slugsWith } from "./capabilities.js";
import { entity } from "../test/builders/scope.js";

import type { NormalizedOptions } from "./options.js";

const options = {
	collections: [
		{
			slug: "pages",
			read: true,
			write: "live",
			hasDrafts: true,
			fieldName: "pages",
		},
		{
			slug: "my-tags",
			read: true,
			write: false,
			hasDrafts: false,
			fieldName: "myTags",
		},
	],
	globals: [
		{
			slug: "site-settings",
			read: true,
			write: "draft",
			hasDrafts: true,
			fieldName: "siteSettings",
		},
		{
			slug: "banner",
			read: true,
			write: false,
			hasDrafts: false,
			fieldName: "banner",
		},
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
			"site-settings": { read: true, write: true, publish: false },
			banner: { read: true, write: false, publish: false },
		});
		expect(slugsWith(resolved.globals, "read")).toEqual([
			"site-settings",
			"banner",
		]);
		expect(slugsWith(resolved.globals, "write")).toEqual(["site-settings"]);
	});

	it("closes every global on a key issued before globals existed", () => {
		/* Such a key document has no `globals` group at all. */
		const resolved = resolveCapabilities(options, {
			collections: { pages: { read: true, write: true } },
		});

		expect(resolved.globals).toEqual({
			"site-settings": { read: false, write: false, publish: false },
			banner: { read: false, write: false, publish: false },
		});
		expect(slugsWith(resolved.globals, "read")).toEqual([]);
		expect(slugsWith(resolved.globals, "write")).toEqual([]);
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
			pages: { read: true, write: true, publish: false },
			"my-tags": { read: true, write: false, publish: false },
		});
		expect(resolved.tools).toEqual({ echo: true, other: false });
		expect(slugsWith(resolved.collections, "read")).toEqual([
			"pages",
			"my-tags",
		]);
		expect(slugsWith(resolved.collections, "write")).toEqual(["pages"]);
	});

	it("treats a missing checkbox as refused", () => {
		const resolved = resolveCapabilities(options, {
			collections: { pages: { read: true } },
		});

		expect(resolved.collections["pages"]).toEqual({
			read: true,
			write: false,
			publish: false,
		});
		expect(resolved.collections["my-tags"]).toEqual({
			read: false,
			write: false,
			publish: false,
		});
		expect(resolved.tools).toEqual({ echo: false, other: false });
	});

	it("grants publish only where the config allows it and the box is ticked", () => {
		const ticked = resolveCapabilities(options, {
			collections: { pages: { read: true, write: true, publish: true } },
			globals: { siteSettings: { read: true, write: true, publish: true } },
		});

		expect(slugsWith(ticked.collections, "publish")).toEqual(["pages"]);
		// site-settings is write: "draft", so the config never offers publish.
		expect(slugsWith(ticked.globals, "publish")).toEqual([]);
	});

	it("refuses publish to a key that may not write", () => {
		const resolved = resolveCapabilities(options, {
			collections: { pages: { read: true, publish: true } },
		});

		expect(slugsWith(resolved.collections, "publish")).toEqual([]);
	});

	it("closes publish on a key issued before the checkbox existed", () => {
		const resolved = resolveCapabilities(options, {
			collections: { pages: { read: true, write: true } },
		});

		expect(resolved.collections["pages"]).toMatchObject({ publish: false });
		expect(slugsWith(resolved.collections, "publish")).toEqual([]);
	});

	it("survives keys without any capabilities", () => {
		expect(
			slugsWith(resolveCapabilities(options, undefined).collections, "read"),
		).toEqual([]);
		expect(
			slugsWith(resolveCapabilities(options, "garbage").collections, "read"),
		).toEqual([]);
	});

	it("ignores slugs the config does not expose", () => {
		const resolved = resolveCapabilities(options, {
			collections: { users: { read: true, write: true } },
		});

		expect(resolved.collections).not.toHaveProperty("users");
	});
});

describe("canCreate", () => {
	it("follows write everywhere but an upload collection", () => {
		expect(canCreate(entity("pages"))).toBe(true);
		expect(canCreate(entity("pages", { write: "live" }))).toBe(true);
		expect(canCreate(entity("pages", { write: false }))).toBe(false);
		expect(canCreate(entity("pages", { isUpload: true }))).toBe(false);
	});
});
