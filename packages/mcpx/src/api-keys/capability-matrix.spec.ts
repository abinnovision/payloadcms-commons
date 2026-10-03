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
			label: "pages",
			read: true,
			write: true,
			publish: true,
		},
		{
			fieldName: "posts",
			label: "posts",
			read: true,
			write: true,
			publish: false,
		},
		{
			fieldName: "tags",
			label: "tags",
			read: true,
			write: false,
			publish: false,
		},
		{
			fieldName: "media",
			label: "media",
			read: true,
			write: true,
			publish: false,
			hint: "Files are uploaded in the admin panel.",
		},
	],
	globals: [
		{
			fieldName: "siteSettings",
			label: "site-settings",
			read: true,
			write: true,
			publish: true,
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
			},
			{
				slug: "media",
				fieldName: "media",
				read: true,
				write: "draft",
				hasDrafts: true,
				isUpload: true,
			},
			{
				slug: "tags",
				fieldName: "tags",
				read: true,
				write: false,
				hasDrafts: false,
				isUpload: false,
			},
			{
				slug: "snippets",
				fieldName: "snippets",
				read: true,
				write: "live",
				hasDrafts: false,
				isUpload: false,
			},
		],
		globals: [],
		tools: [{ name: "echo", description: "Echoes the input back." }],
	} as unknown as NormalizedOptions;

	it("exposes only what the config allows", () => {
		expect(createCapabilityMatrix(options).collections).toEqual([
			{
				fieldName: "pages",
				label: "pages",
				read: true,
				write: true,
				publish: true,
			},
			{
				fieldName: "media",
				label: "media",
				read: true,
				write: true,
				publish: false,
				hint: "Files are uploaded in the admin panel.",
			},
			{
				fieldName: "tags",
				label: "tags",
				read: true,
				write: false,
				publish: false,
			},
			{
				fieldName: "snippets",
				label: "snippets",
				read: true,
				write: true,
				publish: false,
				hint: "Writes go live immediately.",
			},
		]);
	});

	/*
	 * An upload row departs from the legend because `write` there never reaches
	 * `createDocument`, and a row without drafts because a write is live.
	 */
	it("hints only where a row departs from the legend", () => {
		const rows = createCapabilityMatrix(options).collections;

		expect(rows.filter((row) => row.hint).map((row) => row.label)).toEqual([
			"media",
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
