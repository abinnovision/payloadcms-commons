import { describe, expect, it } from "vitest";

import {
	buildToggleActions,
	capabilityPaths,
	columnState,
	createCapabilityMatrix,
	toolsState,
} from "./capability-matrix.js";

import type {
	CapabilityMatrix,
	CapabilityValues,
} from "./capability-matrix.js";
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

const values = (...granted: string[]): CapabilityValues =>
	Object.fromEntries(granted.map((path) => [path, true]));

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
		]);
	});

	/*
	 * Only an upload row departs from the legend, because `write` there never
	 * reaches `createDocument`.
	 */
	it("hints only where a row departs from the legend", () => {
		const rows = createCapabilityMatrix(options).collections;

		expect(rows.filter((row) => row.hint).map((row) => row.label)).toEqual([
			"media",
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

describe("columnState", () => {
	it("is off when nothing is granted", () => {
		expect(columnState(matrix, BASE, "collections", "read", {})).toBe("off");
	});

	it("is mixed when some rows are granted", () => {
		expect(
			columnState(
				matrix,
				BASE,
				"collections",
				"read",
				values("capabilities.collections.pages.read"),
			),
		).toBe("mixed");
	});

	/*
	 * `tags` exposes no write, so a granted `pages`, `posts` and `media` is the
	 * whole column. A dash must never hold the header back from "on".
	 */
	it("ignores cells the config does not expose", () => {
		expect(
			columnState(
				matrix,
				BASE,
				"collections",
				"write",
				values(
					"capabilities.collections.pages.write",
					"capabilities.collections.posts.write",
					"capabilities.collections.media.write",
				),
			),
		).toBe("on");
	});

	it("reports tool state over the whole list", () => {
		expect(toolsState(matrix, BASE, values("capabilities.tools.echo"))).toBe(
			"mixed",
		);
		expect(toolsState(matrix, BASE, {})).toBe("off");
	});
});

describe("buildToggleActions", () => {
	it("updates one cell", () => {
		expect(
			buildToggleActions(
				matrix,
				BASE,
				{},
				{
					kind: "cell",
					namespace: "collections",
					fieldName: "pages",
					operation: "read",
					value: true,
				},
			),
		).toEqual([
			{
				type: "UPDATE",
				path: "capabilities.collections.pages.read",
				value: true,
			},
		]);
	});

	/*
	 * `publishFlag` discards a publish without a write, so the form must never be
	 * able to save that pair.
	 */
	it("ticks write alongside publish", () => {
		expect(
			buildToggleActions(
				matrix,
				BASE,
				{},
				{
					kind: "cell",
					namespace: "collections",
					fieldName: "pages",
					operation: "publish",
					value: true,
				},
			),
		).toEqual([
			{
				type: "UPDATE",
				path: "capabilities.collections.pages.write",
				value: true,
			},
			{
				type: "UPDATE",
				path: "capabilities.collections.pages.publish",
				value: true,
			},
		]);
	});

	it("clears publish when write is cleared", () => {
		expect(
			buildToggleActions(
				matrix,
				BASE,
				values(
					"capabilities.collections.pages.write",
					"capabilities.collections.pages.publish",
				),
				{
					kind: "cell",
					namespace: "collections",
					fieldName: "pages",
					operation: "write",
					value: false,
				},
			),
		).toEqual([
			{
				type: "UPDATE",
				path: "capabilities.collections.pages.write",
				value: false,
			},
			{
				type: "UPDATE",
				path: "capabilities.collections.pages.publish",
				value: false,
			},
		]);
	});

	it("grants a whole row, skipping what the config withholds", () => {
		expect(
			buildToggleActions(
				matrix,
				BASE,
				{},
				{
					kind: "row",
					namespace: "collections",
					fieldName: "tags",
					value: true,
				},
			),
		).toEqual([
			{
				type: "UPDATE",
				path: "capabilities.collections.tags.read",
				value: true,
			},
		]);
	});

	it("grants a whole column across exposed rows only", () => {
		expect(
			buildToggleActions(
				matrix,
				BASE,
				{},
				{
					kind: "column",
					namespace: "collections",
					operation: "write",
					value: true,
				},
			).map((action) => action.path),
		).toEqual([
			"capabilities.collections.pages.write",
			"capabilities.collections.posts.write",
			"capabilities.collections.media.write",
		]);
	});

	/* The publish rule holds for a bulk grant as much as for a single box. */
	it("carries the publish rule through a column toggle", () => {
		expect(
			buildToggleActions(
				matrix,
				BASE,
				{},
				{
					kind: "column",
					namespace: "collections",
					operation: "publish",
					value: true,
				},
			),
		).toEqual([
			{
				type: "UPDATE",
				path: "capabilities.collections.pages.write",
				value: true,
			},
			{
				type: "UPDATE",
				path: "capabilities.collections.pages.publish",
				value: true,
			},
		]);
	});

	it("clears every publish when the write column is cleared", () => {
		expect(
			buildToggleActions(
				matrix,
				BASE,
				values(
					"capabilities.collections.pages.write",
					"capabilities.collections.pages.publish",
					"capabilities.collections.posts.write",
				),
				{
					kind: "column",
					namespace: "collections",
					operation: "write",
					value: false,
				},
			).map((action) => action.path),
		).toEqual([
			"capabilities.collections.pages.write",
			"capabilities.collections.pages.publish",
			"capabilities.collections.posts.write",
		]);
	});

	it("toggles one tool and every tool", () => {
		expect(
			buildToggleActions(
				matrix,
				BASE,
				{},
				{
					kind: "tool",
					name: "echo",
					value: true,
				},
			),
		).toEqual([
			{ type: "UPDATE", path: "capabilities.tools.echo", value: true },
		]);

		expect(
			buildToggleActions(matrix, BASE, {}, { kind: "tools", value: true }).map(
				(action) => action.path,
			),
		).toEqual([
			"capabilities.tools.echo",
			"capabilities.tools.whichCollection",
		]);
	});

	/* No action means no `setModified`, so a no-op click leaves the form clean. */
	it("emits nothing when the value already holds", () => {
		expect(
			buildToggleActions(
				matrix,
				BASE,
				values("capabilities.collections.pages.read"),
				{
					kind: "cell",
					namespace: "collections",
					fieldName: "pages",
					operation: "read",
					value: true,
				},
			),
		).toEqual([]);
	});

	it("honours a non-default base path", () => {
		expect(
			buildToggleActions(
				matrix,
				"custom",
				{},
				{
					kind: "tool",
					name: "echo",
					value: true,
				},
			),
		).toEqual([{ type: "UPDATE", path: "custom.tools.echo", value: true }]);
	});
});
