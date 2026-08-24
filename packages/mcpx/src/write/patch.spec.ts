import { beforeAll, describe, expect, it } from "vitest";

import {
	applyPatchToCopy,
	buildWriteData,
	droppedPointer,
	findPatchProblems,
	isElementPointer,
	isReservedPointer,
	PATCH_OPERATION_SCHEMA,
} from "./patch.js";
import { buildFixtureConfig } from "../../test/fixtures/config.js";
import { collectionOf } from "../schema/walk.js";

import type { SanitizedConfig } from "payload";
import type { Operation } from "rfc6902";

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
		for (const op of ["add", "copy", "move", "remove", "replace", "test"]) {
			expect(PATCH_OPERATION_SCHEMA.safeParse({ op, path: "/a" }).success).toBe(
				true,
			);
		}
	});

	it("rejects an unknown operation", () => {
		expect(
			PATCH_OPERATION_SCHEMA.safeParse({ op: "set", path: "/a" }).success,
		).toBe(false);
	});
});

describe("pointer helpers", () => {
	it("recognises pointers at fields Payload maintains", () => {
		expect(isReservedPointer("/_status")).toBe(true);
		expect(isReservedPointer("/layout/sections/0/id")).toBe(true);
		expect(isReservedPointer("/title")).toBe(false);
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

describe("applyPatchToCopy", () => {
	it("sets an absent field when replace addresses it", () => {
		const result = applyPatchToCopy({ slug: "home" }, [
			{ op: "replace", path: "/title", value: "Startseite" },
		]);

		expect(result).toEqual({ next: { slug: "home", title: "Startseite" } });
	});

	it("applies on a copy and leaves the original untouched", () => {
		const result = applyPatchToCopy(DOC, [
			{ op: "replace", path: "/title", value: "New" },
		]);

		expect(result).toEqual({
			next: expect.objectContaining({ title: "New" }),
		});
		expect(DOC.title).toBe("Home");
	});

	it("applies nothing when one operation fails", () => {
		const result = applyPatchToCopy(DOC, [
			{ op: "replace", path: "/title", value: "New" },
			{ op: "test", path: "/layout/color", value: "dark" },
		]);

		expect(result).toEqual({
			problems: [expect.stringContaining("patches[1]")],
		});
	});

	it("strips row ids from added and copied rows", () => {
		const result = applyPatchToCopy(DOC, [
			{
				op: "add",
				path: "/layout/sections/-",
				value: { id: "row-1", blockType: "richText", content: null },
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
		const result = applyPatchToCopy(DOC, [
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
		const result = applyPatchToCopy({ items: [] }, [
			{ op: "add", path: "/items/-", value: { id: "foreign", title: "x" } },
		]);

		expect(result).toEqual({ next: { items: [{ title: "x" }] } });
	});
});

describe("findPatchProblems", () => {
	let config: SanitizedConfig;

	beforeAll(async () => {
		config = await buildFixtureConfig();
	});

	const problemsFor = (patches: Operation[]): string[] =>
		findPatchProblems(config, { collection: "pages", doc: DOC, patches });

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

	it("reports every bad operation rather than only the first", () => {
		expect(
			problemsFor([
				{ op: "replace", path: "/titel", value: "x" },
				{ op: "replace", path: "/_status", value: "published" },
			]),
		).toHaveLength(2);
	});
});

describe("buildWriteData", () => {
	let config: SanitizedConfig;

	beforeAll(async () => {
		config = await buildFixtureConfig();
	});

	it("keeps describable fields and row identity, drops what Payload owns", () => {
		const data = buildWriteData(config, collectionOf(config, "pages"), {
			...DOC,
			_status: "draft",
			createdAt: "2026-01-01T00:00:00.000Z",
			updatedAt: "2026-01-01T00:00:00.000Z",
			unknown: "x",
			meta: { title: "Meta", stray: true },
		});

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
});
