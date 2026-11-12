import { describe, expect, it } from "vitest";

import {
	changedRows,
	conflictingPaths,
	dirtyFields,
	isEqual,
	mergePlan,
	valueAt,
} from "./document-merge.js";

import type { FieldEntry } from "./document-merge.js";

// The form as Payload loaded it from LOADED, before the user typed.
const LOADED = {
	title: "Hello world",
	intro: "Welcome",
	hero: { title: "Hero", body: { root: { children: [] } } },
	sections: [
		{ id: "row-a", blockType: "text", heading: "A" },
		{ id: "row-b", blockType: "text", heading: "B" },
	],
};

const loadedFields = (): Record<string, FieldEntry> => ({
	id: { value: 12, initialValue: 12 },
	title: { value: "Hello world", initialValue: "Hello world" },
	intro: { value: "Welcome", initialValue: "Welcome" },
	"hero.title": { value: "Hero", initialValue: "Hero" },
	"hero.body": {
		value: { root: { children: [] } },
		initialValue: { root: { children: [] } },
	},
	sections: {
		value: 2,
		initialValue: 2,
		rows: [{ id: "row-a" }, { id: "row-b" }],
	},
	"sections.0.id": { value: "row-a", initialValue: "row-a" },
	"sections.0.blockType": { value: "text", initialValue: "text" },
	"sections.0.heading": { value: "A", initialValue: "A" },
	"sections.1.id": { value: "row-b", initialValue: "row-b" },
	"sections.1.blockType": { value: "text", initialValue: "text" },
	"sections.1.heading": { value: "B", initialValue: "B" },
});

// The form after the user typed into `path`.
const typed = (
	path: string,
	value: unknown,
	fields = loadedFields(),
): Record<string, FieldEntry> => ({
	...fields,
	[path]: { ...fields[path], value },
});

describe("isEqual", () => {
	it("compares nested values by content", () => {
		expect(isEqual({ a: [1, { b: "c" }] }, { a: [1, { b: "c" }] })).toBe(true);
		expect(isEqual({ a: [1] }, { a: [1, 2] })).toBe(false);
		expect(isEqual({ a: 1 }, { b: 1 })).toBe(false);
		expect(isEqual(null, undefined)).toBe(false);
	});
});

describe("dirtyFields", () => {
	it("lists the leaf values that differ from what the form loaded", () => {
		const fields = typed("hero.body", { root: { children: ["text"] } });

		expect(dirtyFields(typed("intro", "Hi", fields))).toEqual([
			{ path: "intro", value: "Hi" },
			{ path: "hero.body", value: { root: { children: ["text"] } } },
		]);
	});

	it("leaves out array parents and row metadata", () => {
		const fields = {
			...loadedFields(),
			sections: { value: 3, initialValue: 2, rows: [] },
			"sections.2.id": { value: "row-c", initialValue: undefined },
			"sections.2.blockType": { value: "text", initialValue: undefined },
		};

		expect(dirtyFields(fields)).toEqual([]);
	});
});

describe("changedRows", () => {
	it("finds an array whose rows were moved, added or removed", () => {
		const moved = {
			...loadedFields(),
			sections: {
				value: 2,
				initialValue: 2,
				rows: [{ id: "row-b" }, { id: "row-a" }],
			},
		};
		const removed = {
			...loadedFields(),
			sections: { value: 1, initialValue: 2, rows: [{ id: "row-a" }] },
		};

		expect(changedRows(moved, LOADED)).toEqual(["sections"]);
		expect(changedRows(removed, LOADED)).toEqual(["sections"]);
		expect(changedRows(loadedFields(), LOADED)).toEqual([]);
	});
});

describe("conflictingPaths", () => {
	it("lists the user's paths whose server value changed since the form loaded", () => {
		const fields = typed("title", "Mine", typed("intro", "Hi"));
		const dirty = dirtyFields(fields);

		expect(
			conflictingPaths(fields, dirty, { ...LOADED, title: "Agent" }),
		).toEqual(["title"]);
	});
});

describe("valueAt", () => {
	it("reads through rows", () => {
		expect(valueAt(LOADED, "sections.1.heading")).toBe("B");
		expect(valueAt(LOADED, "sections.2.heading")).toBeUndefined();
	});
});

describe("mergePlan", () => {
	it("merges around rows nested in rows that did not change", () => {
		const nested = {
			slug: "hello",
			layout: [{ id: "outer", modules: [{ id: "inner", title: "Hero" }] }],
		};
		const fields: Record<string, FieldEntry> = {
			slug: { value: "mine", initialValue: "hello" },
			layout: { value: 1, initialValue: 1, rows: [{ id: "outer" }] },
			"layout.0.modules": {
				value: 1,
				initialValue: 1,
				rows: [{ id: "inner" }],
			},
			"layout.0.modules.0.title": { value: "Mine", initialValue: "Hero" },
		};
		const server = {
			slug: "hello",
			layout: [{ id: "outer", modules: [{ id: "inner", title: "Agent" }] }],
		};

		expect(mergePlan(fields, nested, server)).toEqual({
			kind: "merge",
			dirty: [
				{ path: "slug", value: "mine" },
				{ path: "layout.0.modules.0.title", value: "Mine" },
			],
			conflicts: ["layout.0.modules.0.title"],
		});
	});

	it("keeps the user's values and finds no conflict when the agent changed other fields", () => {
		expect(
			mergePlan(typed("title", "Mine"), LOADED, {
				...LOADED,
				hero: { ...LOADED.hero, title: "Hello sections" },
			}),
		).toEqual({
			kind: "merge",
			dirty: [{ path: "title", value: "Mine" }],
			conflicts: [],
		});
	});

	it("lists a field both changed as a conflict", () => {
		expect(
			mergePlan(typed("title", "Mine"), LOADED, { ...LOADED, title: "Agent" }),
		).toEqual({
			kind: "merge",
			dirty: [{ path: "title", value: "Mine" }],
			conflicts: ["title"],
		});
	});

	it("goes stale when the user moved rows", () => {
		const fields = {
			...loadedFields(),
			sections: {
				value: 2,
				initialValue: 2,
				rows: [{ id: "row-b" }, { id: "row-a" }],
			},
		};

		expect(mergePlan(fields, LOADED, LOADED)).toEqual({ kind: "stale" });
	});

	it("goes stale when the agent changed the rows around a value of the user", () => {
		const server = { ...LOADED, sections: [LOADED.sections[1]] };

		expect(
			mergePlan(typed("sections.1.heading", "Mine"), LOADED, server),
		).toEqual({ kind: "stale" });
	});

	it("merges when the agent changed rows the user did not touch", () => {
		const server = { ...LOADED, sections: [LOADED.sections[1]] };

		expect(mergePlan(typed("title", "Mine"), LOADED, server)).toEqual({
			kind: "merge",
			dirty: [{ path: "title", value: "Mine" }],
			conflicts: [],
		});
	});
});
