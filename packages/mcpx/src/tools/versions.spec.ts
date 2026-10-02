import { Pointer } from "rfc6902";
import { describe, expect, it } from "vitest";

import { diffDocuments, isVersionOf } from "./versions.js";

describe("isVersionOf", () => {
	it("matches a raw or populated parent across id types", () => {
		expect(isVersionOf({ parent: 7 }, "7")).toBe(true);
		expect(isVersionOf({ parent: { id: "7" } }, 7)).toBe(true);
		expect(isVersionOf({ parent: 8 }, 7)).toBe(false);
		expect(isVersionOf({}, 7)).toBe(false);
	});
});

describe("diffDocuments", () => {
	const from = {
		id: 1,
		title: "Old",
		layout: { color: "light" },
		updatedAt: "2026-01-01T00:00:00.000Z",
		createdAt: "2026-01-01T00:00:00.000Z",
		_status: "published",
	};
	const to = {
		title: "New",
		layout: { color: "dark" },
		updatedAt: "2026-02-01T00:00:00.000Z",
		createdAt: "2026-01-01T00:00:00.000Z",
		_status: "draft",
	};

	it("leaves bookkeeping fields out", () => {
		expect(diffDocuments(from, to)).toEqual([
			{ op: "replace", path: "/title", value: "New" },
			{ op: "replace", path: "/layout/color", value: "dark" },
		]);
	});

	it("keeps op paths absolute when scoped to a path", () => {
		expect(diffDocuments(from, to, Pointer.fromJSON("/layout"))).toEqual([
			{ op: "replace", path: "/layout/color", value: "dark" },
		]);
	});

	it("adds or removes a subtree missing on one side", () => {
		expect(diffDocuments({}, to, Pointer.fromJSON("/layout"))).toEqual([
			{ op: "add", path: "/layout", value: { color: "dark" } },
		]);
		expect(diffDocuments(from, {}, Pointer.fromJSON("/layout"))).toEqual([
			{ op: "remove", path: "/layout" },
		]);
	});
});
