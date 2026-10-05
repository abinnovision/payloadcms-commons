import { describe, expect, it } from "vitest";

import {
	capabilityPaths,
	createCapabilityMatrix,
} from "./capability-matrix.js";

import type { CapabilityMatrix } from "./capability-matrix.js";
import type { NormalizedOptions } from "../options.js";

const BASE = "capabilities";

/*
 * Mirrors the integration fixture: a versioned collection that publishes, one
 * that only drafts, a read-only one, and an upload.
 */
const matrix: CapabilityMatrix = {
	collections: [
		{
			fieldName: "pages",
			slug: "pages",
			read: true,
			write: true,
			publish: true,
			delete: false,
			deleteUnattended: false,
		},
		{
			fieldName: "posts",
			slug: "posts",
			read: true,
			write: true,
			publish: false,
			delete: false,
			deleteUnattended: false,
		},
		{
			fieldName: "tags",
			slug: "tags",
			read: true,
			write: false,
			publish: false,
			delete: false,
			deleteUnattended: false,
		},
		{
			fieldName: "media",
			slug: "media",
			read: true,
			write: true,
			publish: false,
			delete: false,
			deleteUnattended: false,
		},
	],
	globals: [
		{
			fieldName: "siteSettings",
			slug: "site-settings",
			read: true,
			write: true,
			publish: true,
			delete: false,
			deleteUnattended: false,
		},
	],
	tools: [
		{ name: "echo", description: "Echoes the input back." },
		{ name: "whichCollection", description: "Names the collection." },
	],
};

describe("createCapabilityMatrix", () => {
	const options = {
		collections: [
			{
				slug: "pages",
				fieldName: "pages",
				read: true,
				write: "live",
				hasDrafts: true,
				isUpload: false,
				delete: false,
				deleteUnattended: false,
			},
			{
				slug: "media",
				fieldName: "media",
				read: true,
				write: "draft",
				hasDrafts: true,
				isUpload: true,
				delete: false,
				deleteUnattended: false,
			},
			{
				slug: "tags",
				fieldName: "tags",
				read: true,
				write: false,
				hasDrafts: false,
				isUpload: false,
				delete: false,
				deleteUnattended: false,
			},
			{
				slug: "snippets",
				fieldName: "snippets",
				read: true,
				write: "live",
				hasDrafts: false,
				isUpload: false,
				delete: false,
				deleteUnattended: false,
			},
		],
		globals: [],
		tools: [{ name: "echo", description: "Echoes the input back." }],
	} as unknown as NormalizedOptions;

	it("exposes only what the config allows", () => {
		expect(createCapabilityMatrix(options).collections).toEqual([
			{
				fieldName: "pages",
				slug: "pages",
				read: true,
				write: true,
				publish: true,
				delete: false,
				deleteUnattended: false,
			},
			{
				fieldName: "media",
				slug: "media",
				read: true,
				write: true,
				publish: false,
				delete: false,
				deleteUnattended: false,
			},
			{
				fieldName: "tags",
				slug: "tags",
				read: true,
				write: false,
				publish: false,
				delete: false,
				deleteUnattended: false,
			},
			{
				fieldName: "snippets",
				slug: "snippets",
				read: true,
				write: true,
				publish: false,
				delete: false,
				deleteUnattended: false,
				live: true,
			},
		]);
	});

	// Without drafts a write has no draft stage to land in.
	it("marks only rows whose writes go live", () => {
		const rows = createCapabilityMatrix(options).collections;

		expect(rows.filter((row) => row.live).map((row) => row.slug)).toEqual([
			"snippets",
		]);
	});

	it("falls back to the tool name when the description is built per request", () => {
		const built = createCapabilityMatrix({
			...options,
			tools: [{ name: "echo", description: () => "later" }],
		} as unknown as NormalizedOptions);

		expect(built.tools).toEqual([{ name: "echo", description: "echo" }]);
	});
});

describe("capabilityPaths", () => {
	it("addresses every exposed cell and no dash", () => {
		expect(capabilityPaths(matrix, BASE)).toEqual([
			"capabilities.collections.pages.read",
			"capabilities.collections.pages.write",
			"capabilities.collections.pages.publish",
			"capabilities.collections.posts.read",
			"capabilities.collections.posts.write",
			"capabilities.collections.tags.read",
			"capabilities.collections.media.read",
			"capabilities.collections.media.write",
			"capabilities.globals.siteSettings.read",
			"capabilities.globals.siteSettings.write",
			"capabilities.globals.siteSettings.publish",
			"capabilities.tools.echo",
			"capabilities.tools.whichCollection",
		]);
	});
});
