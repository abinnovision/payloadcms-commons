import { describe, expect, it } from "vitest";

import { fileAttributes, isRefId, readFileAttributes } from "./files.js";

import type { FileRef } from "./files.js";

const ref = (
	overrides: Partial<FileRef> = {},
): Omit<FileRef, "collection"> => ({
	id: "7",
	name: "notes.txt",
	mimeType: "text/plain",
	size: 12,
	attached: false,
	...overrides,
});

const roundTrip = (files: Omit<FileRef, "collection">[]): FileRef[] =>
	readFileAttributes(fileAttributes("uploads", files));

describe("fileAttributes", () => {
	it("writes no attributes without files", () => {
		expect(fileAttributes("uploads", [])).toEqual({});
	});

	it("round-trips files in order and marks the attached ones", () => {
		const files = [
			ref(),
			ref({ id: "8", name: "a.png", mimeType: "image/png", attached: true }),
		];

		expect(roundTrip(files)).toEqual(
			files.map((file) => ({ ...file, collection: "uploads" })),
		);
	});

	it("removes the characters Flue escapes, the separators and control characters from names", () => {
		const attributes = fileAttributes("uploads", [
			ref({ name: `a&b<c>d"e'f|g;h\ni\u0007j.txt` }),
		]);

		expect(attributes["files"]).not.toMatch(/[&<>"']/);
		expect(readFileAttributes(attributes)[0]?.name).toBe("abcdefghij.txt");
	});

	it("cuts names to 120 characters", () => {
		expect(roundTrip([ref({ name: "x".repeat(300) })])[0]?.name).toHaveLength(
			120,
		);
	});

	it("drops MIME type parameters and keeps the type", () => {
		expect(
			roundTrip([ref({ mimeType: "text/csv; charset=utf-8" })])[0]?.mimeType,
		).toBe("text/csv");
	});

	it("reads a malformed MIME type as bytes", () => {
		expect(roundTrip([ref({ mimeType: 'x"y' })])[0]?.mimeType).toBe(
			"application/octet-stream",
		);
	});

	it.each(["1|2", "1;2", ""])("refuses the id %j", (id) => {
		expect(isRefId(id)).toBe(false);
		expect(() => fileAttributes("uploads", [ref({ id })])).toThrow(
			/cannot be referenced/,
		);
	});

	it("keeps ObjectId and UUID ids", () => {
		const ids = [
			"6743f0c1a2b3c4d5e6f70812",
			"9b2f4c1e-0d3a-4e5b-8c7d-112233445566",
		];

		expect(
			roundTrip(ids.map((id) => ref({ id }))).map((file) => file.id),
		).toEqual(ids);
	});
});

describe("readFileAttributes", () => {
	it("reads nothing without the collection", () => {
		expect(readFileAttributes({ files: "1|text/plain|1|a" })).toEqual([]);
	});

	it.each([
		["a missing name", "1|text/plain|1"],
		["an extra field", "1|text/plain|1|a|b"],
		["a size that is no count", "1|text/plain|x|a"],
		["a malformed type", "1|text|1|a"],
	])("skips an entry with %s", (_label, entry) => {
		expect(
			readFileAttributes({
				files: `${entry}; 2|text/plain|1|b`,
				filesCollection: "uploads",
			}).map((file) => file.id),
		).toEqual(["2"]);
	});
});
