import { beforeAll, describe, expect, it } from "vitest";

import {
	applyPatchOperations,
	buildWriteData,
	droppedPointer,
	isElementPointer,
	isReservedPointer,
	PATCH_OPERATION_SCHEMA,
} from "./patch.js";
import { buildFixtureConfig } from "../../test/fixtures/config.js";
import { targetOf } from "../schema/walk.js";

import type { SanitizedConfig } from "payload";
import type { Operation } from "rfc6902";

/** The smallest state the rich text shape check accepts. */
const EMPTY_RICH_TEXT = {
	root: {
		children: [
			{
				children: [],
				direction: null,
				format: "",
				indent: 0,
				type: "paragraph",
				version: 1,
			},
		],
		direction: null,
		format: "",
		indent: 0,
		type: "root",
		version: 1,
	},
};

const DOC = {
	id: "p1",
	layout: {
		color: "light",
		sections: [
			{
				id: "row-1",
				blockType: "sectionWrapper",
				identifier: "first",
				modules: [{ id: "row-2", blockType: "hero", imageSize: "small" }],
			},
		],
	},
	title: "Home",
};

describe("pATCH_OPERATION_SCHEMA", () => {
	it("accepts the six RFC 6902 operations", () => {
		const operations = [
			{ op: "add", path: "/a", value: 1 },
			{ from: "/b", op: "copy", path: "/a" },
			{ from: "/b", op: "move", path: "/a" },
			{ op: "remove", path: "/a" },
			{ op: "replace", path: "/a", value: 1 },
			{ op: "test", path: "/a", value: 1 },
		];

		for (const operation of operations) {
			expect(PATCH_OPERATION_SCHEMA.safeParse(operation).success).toBe(true);
		}
	});

	it("rejects an unknown operation", () => {
		expect(
			PATCH_OPERATION_SCHEMA.safeParse({ op: "set", path: "/a" }).success,
		).toBe(false);
	});

	it("rejects members the operation does not take", () => {
		expect(
			PATCH_OPERATION_SCHEMA.safeParse({
				from: "/b",
				op: "copy",
				path: "/a",
				value: 1,
			}).success,
		).toBe(false);

		expect(
			PATCH_OPERATION_SCHEMA.safeParse({ from: "/b", op: "add", path: "/a" })
				.success,
		).toBe(false);
	});

	it("requires a source pointer on copy and move", () => {
		expect(
			PATCH_OPERATION_SCHEMA.safeParse({ op: "copy", path: "/a" }).success,
		).toBe(false);
	});
});

describe("pointer helpers", () => {
	it("recognises pointers at fields Payload maintains", () => {
		expect(isReservedPointer("/_status")).toBe(true);
		expect(isReservedPointer("/layout/sections/0/id")).toBe(true);
		expect(isReservedPointer("/title")).toBe(false);
		/* A Lexical block node's row id is one of them; its own keys are not. */
		expect(isReservedPointer("/content/root/children/0/fields/id")).toBe(true);
		expect(isReservedPointer("/content/root/children/0/version")).toBe(false);
	});

	it("tells list elements from fields", () => {
		expect(isElementPointer("/layout/sections/0")).toBe(true);
		expect(isElementPointer("/layout/sections/-")).toBe(true);
		expect(isElementPointer("/layout/color")).toBe(false);
	});

	it("reports what an operation drops", () => {
		expect(droppedPointer({ op: "remove", path: "/a" })).toBe("/a");
		expect(droppedPointer({ op: "move", from: "/a", path: "/b" })).toBe("/a");
		expect(droppedPointer({ op: "replace", path: "/a", value: 1 })).toBe(
			undefined,
		);
	});
});

/** A link node, so a read-only field has a node's own fields to address. */
const LINK_NODE = {
	children: [],
	direction: "ltr",
	fields: { linkType: "custom", newTab: false, url: "/old" },
	format: "",
	indent: 0,
	type: "link",
	version: 3,
};

const POSTS_DOC = {
	id: "s1",
	items: [{ id: "item-1", heading: "First" }],
	locked: {
		body: { root: { ...EMPTY_RICH_TEXT.root, children: [LINK_NODE] } },
		entries: [{ id: "entry-1", label: "one" }],
		note: "kept",
		sections: [{ id: "block-1", blockType: "cta", label: "Go" }],
	},
	title: "Post",
};

describe("applyPatchOperations", () => {
	let config: SanitizedConfig;

	beforeAll(async () => {
		config = await buildFixtureConfig();
	});

	const apply = (
		doc: Record<string, unknown>,
		patches: Operation[],
		slug = "pages",
	): { next: Record<string, unknown> } | { problems: string[] } =>
		applyPatchOperations(config, {
			doc,
			patches,
			ref: { kind: "collection", slug },
		});

	const problemsFor = (patches: Operation[]): string[] => {
		const result = apply(DOC, patches);

		return "problems" in result ? result.problems : [];
	};

	it("sets an absent field when replace addresses it", () => {
		const result = apply({ id: "p1", slug: "home" }, [
			{ op: "replace", path: "/title", value: "Startseite" },
		]);

		expect(result).toEqual({
			next: { id: "p1", slug: "home", title: "Startseite" },
		});
	});

	it("applies on a copy and leaves the original untouched", () => {
		const result = apply(DOC, [
			{ op: "replace", path: "/title", value: "New" },
		]);

		expect(result).toEqual({
			next: expect.objectContaining({ title: "New" }),
		});
		expect(DOC.title).toBe("Home");
	});

	it("applies nothing when one operation fails", () => {
		const result = apply(DOC, [
			{ op: "replace", path: "/title", value: "New" },
			{ op: "test", path: "/layout/color", value: "dark" },
		]);

		expect(result).toEqual({
			problems: [expect.stringContaining("patches[1]")],
		});
	});

	it("resolves an operation against what the ones before it produced", () => {
		const result = apply(DOC, [
			{
				op: "add",
				path: "/layout/sections/-",
				value: { blockType: "richText", content: EMPTY_RICH_TEXT },
			},
			{
				op: "replace",
				path: "/layout/sections/1/content",
				value: EMPTY_RICH_TEXT,
			},
		]);

		expect(result).toHaveProperty("next");
	});

	it("strips row ids from added and copied rows", () => {
		const result = apply(DOC, [
			{
				op: "add",
				path: "/layout/sections/-",
				value: {
					id: "row-1",
					blockType: "richText",
					content: EMPTY_RICH_TEXT,
				},
			},
			{ op: "copy", from: "/layout/sections/0", path: "/layout/sections/-" },
		]);

		expect(result).toHaveProperty("next");

		const { next } = result as { next: Record<string, unknown> };
		const sections = (next["layout"] as { sections: Record<string, unknown>[] })
			.sections;

		expect(sections).toHaveLength(3);
		expect(sections[0]).toMatchObject({ id: "row-1" });
		expect(sections[1]).not.toHaveProperty("id");
		expect(sections[2]).not.toHaveProperty("id");
		expect(
			(sections[2]?.["modules"] as Record<string, unknown>[])[0],
		).not.toHaveProperty("id");
	});

	it("keeps stored row ids on a whole-field replace, so rows update in place", () => {
		const result = apply(DOC, [
			{
				op: "replace",
				path: "/layout/sections",
				value: [
					{
						id: "row-1",
						blockType: "sectionWrapper",
						identifier: "renamed",
						modules: [{ id: "row-2", blockType: "hero", imageSize: "large" }],
					},
				],
			},
		]);

		expect(result).toHaveProperty("next");

		const { next } = result as { next: Record<string, unknown> };
		const sections = (next["layout"] as { sections: Record<string, unknown>[] })
			.sections;

		expect(sections[0]).toMatchObject({ id: "row-1", identifier: "renamed" });
		expect(
			(sections[0]?.["modules"] as Record<string, unknown>[])[0],
		).toMatchObject({ id: "row-2", imageSize: "large" });
	});

	it("strips a client id from a row appended to a plain array", () => {
		const result = apply(
			{ id: "s1", items: [] },
			[{ op: "add", path: "/items/-", value: { id: "foreign", heading: "x" } }],
			"posts",
		);

		expect(result).toEqual({
			next: { id: "s1", items: [{ heading: "x" }] },
		});
	});

	it("accepts a well-formed replace", () => {
		expect(
			problemsFor([{ op: "replace", path: "/title", value: "New" }]),
		).toEqual([]);
	});

	it("refuses an empty pointer", () => {
		expect(problemsFor([{ op: "replace", path: "", value: {} }])).toEqual([
			expect.stringContaining("whole document"),
		]);
	});

	it("refuses a pointer at a field Payload maintains", () => {
		expect(
			problemsFor([{ op: "replace", path: "/_status", value: "published" }]),
		).toEqual([expect.stringContaining("a field Payload maintains")]);
	});

	it("refuses a pointer that does not resolve, listing what does", () => {
		expect(
			problemsFor([{ op: "replace", path: "/titel", value: "x" }]),
		).toEqual([expect.stringContaining("Available: /title, /slug")]);
	});

	it("refuses remove on a field but allows it on a list element", () => {
		expect(problemsFor([{ op: "remove", path: "/layout/color" }])).toEqual([
			expect.stringContaining("is a field, not a list element"),
		]);

		expect(problemsFor([{ op: "remove", path: "/layout/sections/0" }])).toEqual(
			[],
		);
	});

	it("refuses a move that would clear a field", () => {
		expect(
			problemsFor([{ from: "/title", op: "move", path: "/meta/title" }]),
		).toEqual([expect.stringContaining("is a field, not a list element")]);
	});

	it("gates the shape of an added block", () => {
		expect(
			problemsFor([
				{
					op: "add",
					path: "/layout/sections/-",
					value: { blockType: "richText", contnet: null },
				},
			]),
		).toEqual([expect.stringContaining("no such field")]);

		expect(
			problemsFor([
				{
					op: "add",
					path: "/layout/sections/-",
					value: { blockType: "hero" },
				},
			]),
		).toEqual([expect.stringContaining("is not allowed")]);
	});

	it("stops at the first operation that fails", () => {
		expect(
			problemsFor([
				{ op: "replace", path: "/titel", value: "x" },
				{ op: "replace", path: "/_status", value: "published" },
			]),
		).toEqual([expect.stringContaining("patches[0]")]);
	});
});

describe("applyPatchOperations against read-only fields", () => {
	let config: SanitizedConfig;

	beforeAll(async () => {
		config = await buildFixtureConfig();
	});

	const problemsFor = (patches: Operation[]): string[] => {
		const result = applyPatchOperations(config, {
			doc: POSTS_DOC,
			patches,
			ref: { kind: "collection", slug: "posts" },
		});

		return "problems" in result ? result.problems : [];
	};

	const CASES: { name: string; patches: Operation[] }[] = [
		{
			name: "replace of a scalar",
			patches: [{ op: "replace", path: "/locked/note", value: "changed" }],
		},
		{
			name: "add to a list",
			patches: [
				{ op: "add", path: "/locked/entries/-", value: { label: "two" } },
			],
		},
		{
			name: "replace of a blocks field",
			patches: [{ op: "replace", path: "/locked/sections", value: [] }],
		},
		{
			name: "replace of a rich text field",
			patches: [
				{ op: "replace", path: "/locked/body", value: EMPTY_RICH_TEXT },
			],
		},
		{
			name: "copy into a scalar",
			patches: [{ from: "/title", op: "copy", path: "/locked/note" }],
		},
		{
			name: "copy into a block list",
			patches: [
				{ from: "/locked/sections/0", op: "copy", path: "/locked/sections/-" },
			],
		},
		{
			name: "move into a list",
			patches: [{ from: "/items/0", op: "move", path: "/locked/entries/-" }],
		},
		{
			name: "remove of a list element",
			patches: [{ op: "remove", path: "/locked/entries/0" }],
		},
		{
			name: "remove of a block element",
			patches: [{ op: "remove", path: "/locked/sections/0" }],
		},
		{
			name: "move of a list element out",
			patches: [{ from: "/locked/entries/0", op: "move", path: "/items/-" }],
		},
		{
			name: "replace of a node property",
			patches: [
				{
					op: "replace",
					path: "/locked/body/root/children/0/format",
					value: "",
				},
			],
		},
		{
			name: "replace inside a node's own fields",
			patches: [
				{
					op: "replace",
					path: "/locked/body/root/children/0/fields/url",
					value: "/evil",
				},
			],
		},
		{
			name: "replace inside a read-only block's fields",
			patches: [
				{ op: "replace", path: "/locked/sections/0/label", value: "Changed" },
			],
		},
	];

	for (const { name, patches } of CASES) {
		it(`refuses a ${name}`, () => {
			expect(problemsFor(patches)).toEqual([
				expect.stringContaining("read-only"),
			]);
		});
	}

	it("still accepts a write outside the read-only group", () => {
		expect(
			problemsFor([{ op: "replace", path: "/title", value: "Renamed" }]),
		).toEqual([]);
	});
});

describe("buildWriteData", () => {
	let config: SanitizedConfig;

	beforeAll(async () => {
		config = await buildFixtureConfig();
	});

	it("keeps describable fields and row identity, drops what Payload owns", () => {
		const data = buildWriteData(
			config,
			targetOf(config, { kind: "collection", slug: "pages" }),
			{
				...DOC,
				_status: "draft",
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-01T00:00:00.000Z",
				unknown: "x",
				meta: { title: "Meta", stray: true },
			},
		);

		expect(data).toEqual({
			layout: {
				color: "light",
				sections: [
					{
						id: "row-1",
						blockType: "sectionWrapper",
						identifier: "first",
						modules: [{ id: "row-2", blockType: "hero", imageSize: "small" }],
					},
				],
			},
			meta: { title: "Meta" },
			title: "Home",
		});
	});

	it("drops the base fields of an upload document", () => {
		const data = buildWriteData(
			config,
			targetOf(config, { kind: "collection", slug: "media" }),
			{
				id: "m1",
				alt: "A cat",
				credit: "Nobody",
				filename: "cat.png",
				mimeType: "image/png",
				filesize: 1234,
				width: 800,
				height: 600,
				url: "/media/cat.png",
				thumbnailURL: "https://example.test/media/cat.png",
				focalX: 50,
				focalY: 50,
			},
		);

		expect(data).toEqual({ alt: "A cat", credit: "Nobody" });
	});
});

describe("dropping a pointer inside an editor state", () => {
	let config: SanitizedConfig;

	beforeAll(async () => {
		config = await buildFixtureConfig();
	});

	const paragraph = {
		children: [],
		direction: null,
		format: "",
		indent: 0,
		type: "paragraph",
		version: 1,
	};

	const doc = {
		id: "p1",
		content: {
			root: { ...EMPTY_RICH_TEXT.root, children: [paragraph, paragraph] },
		},
		title: "Post",
	};

	const remove = (path: string) =>
		applyPatchOperations(config, {
			doc,
			patches: [{ op: "remove", path }],
			ref: { kind: "collection", slug: "posts" },
		});

	it("removes a node, which is a list element like any other", () => {
		const applied = remove("/content/root/children/0");

		expect(applied).not.toHaveProperty("problems");
		expect(
			(applied as { next: { content: { root: { children: unknown[] } } } }).next
				.content.root.children,
		).toHaveLength(1);
	});

	it("refuses a node property, because the node needs it", () => {
		expect(remove("/content/root/children/0/indent")).toEqual({
			problems: [
				expect.stringContaining(
					'is a node property, not a list element. A "paragraph" node needs it',
				),
			],
		});
	});

	it("refuses the structure a state is made of, and says why", () => {
		expect(remove("/content/root/children")).toEqual({
			problems: [
				expect.stringContaining(
					"sits inside an editor state, which is written whole, so removing it would take effect",
				),
			],
		});
	});

	it("gives a node's own field the reason that applies inside a state", () => {
		const withLink = {
			id: "p1",
			content: {
				root: {
					...EMPTY_RICH_TEXT.root,
					children: [
						{
							children: [],
							direction: "ltr",
							fields: { linkType: "custom", newTab: false, url: "/x" },
							format: "",
							indent: 0,
							type: "link",
							version: 3,
						},
					],
				},
			},
			title: "Post",
		};

		expect(
			applyPatchOperations(config, {
				doc: withLink,
				patches: [
					{ op: "remove", path: "/content/root/children/0/fields/url" },
				],
				ref: { kind: "collection", slug: "posts" },
			}),
		).toEqual({
			problems: [expect.stringContaining("sits inside an editor state")],
		});
	});

	it("refuses removing the only node, which empties the state", () => {
		const single = {
			id: "p1",
			content: { root: { ...EMPTY_RICH_TEXT.root, children: [paragraph] } },
			title: "Post",
		};

		expect(
			applyPatchOperations(config, {
				doc: single,
				patches: [{ op: "remove", path: "/content/root/children/0" }],
				ref: { kind: "collection", slug: "posts" },
			}),
		).toEqual({
			problems: [expect.stringContaining("needs at least one node")],
		});
	});

	it("still refuses a plain field with the reason that applies to it", () => {
		expect(remove("/title")).toEqual({
			problems: [expect.stringContaining("removing it would do nothing")],
		});
	});
});
