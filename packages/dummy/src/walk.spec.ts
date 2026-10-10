import { describe, expect, it } from "vitest";

import {
	DummyRowMismatchError,
	graftRowIds,
	isPlainObject,
	isRichTextState,
} from "./walk.js";

describe("isPlainObject", () => {
	it("accepts an object literal and rejects everything else", () => {
		expect(isPlainObject({})).toBe(true);
		expect(isPlainObject(Object.create(null))).toBe(true);
		expect(isPlainObject([])).toBe(false);
		expect(isPlainObject(null)).toBe(false);
		expect(isPlainObject(new Date())).toBe(false);
		expect(isPlainObject("x")).toBe(false);
	});
});

describe("isRichTextState", () => {
	it("accepts a root whose children is an array", () => {
		expect(isRichTextState({ root: { children: [] } })).toBe(true);
	});

	it("rejects a plain field that merely has a root", () => {
		expect(isRichTextState({ root: "x" })).toBe(false);
		expect(isRichTextState({ title: "x" })).toBe(false);
	});
});

describe("graftRowIds", () => {
	it("copies a row id onto a locale override, by position", () => {
		const incoming = { entries: [{ path: "/thema" }, { path: "/ueber" }] };
		const stored = {
			entries: [
				{ id: "r1", path: "/topic" },
				{ id: "r2", path: "/about" },
			],
		};

		expect(graftRowIds(incoming, stored)).toEqual({
			entries: [
				{ id: "r1", path: "/thema" },
				{ id: "r2", path: "/ueber" },
			],
		});
	});

	it("grafts ids into a nested array too", () => {
		const incoming = {
			layout: [{ modules: [{ title: "Hallo" }] }],
		};
		const stored = {
			layout: [{ id: "b1", modules: [{ id: "m1", title: "Hello" }] }],
		};

		expect(graftRowIds(incoming, stored)).toEqual({
			layout: [{ id: "b1", modules: [{ id: "m1", title: "Hallo" }] }],
		});
	});

	it("keeps an id the override already carries", () => {
		const incoming = { entries: [{ id: "mine", path: "/a" }] };
		const stored = { entries: [{ id: "theirs", path: "/b" }] };

		expect(graftRowIds(incoming, stored)).toEqual({
			entries: [{ id: "mine", path: "/a" }],
		});
	});

	it("does not descend into a rich text state", () => {
		const incoming = { content: { root: { children: [{ text: "de" }] } } };
		const stored = {
			content: { root: { children: [{ id: "n1", text: "en" }] } },
		};

		expect(graftRowIds(incoming, stored)).toEqual(incoming);
	});

	it("refuses a row count mismatch, naming the path", () => {
		const incoming = { layout: [{ modules: [{ a: 1 }, { b: 2 }] }] };
		const stored = {
			layout: [
				{ id: "b1", modules: [{ id: "m1" }, { id: "m2" }, { id: "m3" }] },
			],
		};

		expect(() => graftRowIds(incoming, stored)).toThrow(DummyRowMismatchError);
		expect(() => graftRowIds(incoming, stored)).toThrow(
			/2 rows at "layout.0.modules" where the default locale has 3/,
		);
	});

	it("leaves an override alone when the stored document has no such field", () => {
		const incoming = { entries: [{ path: "/a" }] };

		expect(graftRowIds(incoming, {})).toEqual({ entries: [{ path: "/a" }] });
	});

	it("ignores a scalar where the stored value is an object", () => {
		expect(graftRowIds({ title: "de" }, { title: { id: "x" } })).toEqual({
			title: "de",
		});
	});
});
