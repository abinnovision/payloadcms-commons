import { describe, expect, it } from "vitest";

import {
	assertFilesCollection,
	assertStartedFilesCollection,
} from "./collection.js";

describe("assertFilesCollection", () => {
	it("warns when files may come from a URL", () => {
		const warnings: string[] = [];

		assertFilesCollection(
			{
				slug: "uploads",
				upload: { mimeTypes: ["application/pdf"] },
				fields: [],
			},
			{ warn: (message) => warnings.push(message) },
		);

		expect(warnings).toEqual([
			expect.stringMatching(/upload\.pasteURL: false/),
		]);
	});

	it("takes a collection without URL uploads silently", () => {
		const warnings: string[] = [];

		assertFilesCollection(
			{
				slug: "uploads",
				upload: { mimeTypes: ["application/pdf"], pasteURL: false },
				fields: [],
			},
			{ warn: (message) => warnings.push(message) },
		);

		expect(warnings).toEqual([]);
	});
});

describe("assertStartedFilesCollection", () => {
	const serverOnly = { create: () => false, update: () => false };
	const started = (
		createdBy: Record<string, unknown>,
		flueThread: Record<string, unknown> = {},
	) => ({
		slug: "uploads",
		authorship: { createdBy: true },
		flattenedFields: [
			{
				name: "createdBy",
				type: "relationship",
				relationTo: ["users"],
				access: serverOnly,
				...createdBy,
			},
			{
				name: "flueThread",
				type: "relationship",
				relationTo: "flue-threads",
				access: serverOnly,
				...flueThread,
			},
		],
	});

	it("takes Payload's authorship field and the server-only thread field", async () => {
		await expect(
			assertStartedFilesCollection(started({}), "users"),
		).resolves.toBeUndefined();
	});

	it.each([
		[
			"a createdBy clients may write",
			{ access: { create: () => true, update: () => false } },
		],
		["a createdBy of another user collection", { relationTo: ["admins"] }],
	])("refuses %s", async (_label, createdBy) => {
		await expect(
			assertStartedFilesCollection(started(createdBy), "users"),
		).rejects.toThrow(/authorship createdBy/);
	});

	it("refuses a thread field clients may write", async () => {
		await expect(
			assertStartedFilesCollection(
				started({}, { access: { create: () => false, update: () => true } }),
				"users",
			),
		).rejects.toThrow(/writable by the server only/);
	});
});
