import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootPayload } from "./helpers/payload.js";

import type { Payload } from "payload";

describe("tagged collections", () => {
	let payload: Payload;
	let tagId: number | string;

	beforeAll(async () => {
		payload = await bootPayload("tags-tagged-collections");

		const tag = await payload.create({
			collection: "tags",
			data: { title: "Cascade" },
			overrideAccess: true,
		});

		tagId = tag.id;
	});

	afterAll(async () => {
		await payload.destroy();
	});

	it("appends a sidebar tags field to a collection that had none", () => {
		const pages = payload.collections["pages"]!.config;
		const field = pages.fields.find(
			(candidate) => "name" in candidate && candidate.name === "tags",
		) as { type?: string; relationTo?: string; hasMany?: boolean } | undefined;

		expect(field?.type).toBe("relationship");
		expect(field?.relationTo).toBe("tags");
		expect(field?.hasMany).toBe(true);
	});

	it("lets a document on the appended field carry and filter by tags", async () => {
		const page = await payload.create({
			collection: "pages",
			data: { title: "Landing", tags: [tagId] },
			overrideAccess: true,
			depth: 0,
		});

		expect((page["tags"] as (number | string)[]).map(String)).toContain(
			String(tagId),
		);

		const found = await payload.find({
			collection: "pages",
			where: { tags: { in: [tagId] } },
			overrideAccess: true,
		});

		expect(found.docs.some((doc) => doc.id === page.id)).toBe(true);
	});

	it("removes a deleted tag from a published document's relationship", async () => {
		const doomed = await payload.create({
			collection: "tags",
			data: { title: "Doomed" },
			overrideAccess: true,
		});

		const post = await payload.create({
			collection: "posts",
			data: {
				title: "Published post",
				tags: [doomed.id],
				_status: "published",
			},
			overrideAccess: true,
			draft: false,
		});

		await payload.delete({
			collection: "tags",
			id: doomed.id,
			overrideAccess: true,
		});

		const refreshed = await payload.findByID({
			collection: "posts",
			id: post.id,
			draft: false,
			overrideAccess: true,
			depth: 0,
		});

		expect(
			(refreshed["tags"] as (number | string)[] | undefined) ?? [],
		).not.toContain(doomed.id);
	});

	it("removes a deleted tag from a draft version's relationship", async () => {
		const doomed = await payload.create({
			collection: "tags",
			data: { title: "Doomed Draft" },
			overrideAccess: true,
		});

		const post = await payload.create({
			collection: "posts",
			data: { title: "Draft post", tags: [doomed.id] },
			draft: true,
			overrideAccess: true,
		});

		await payload.delete({
			collection: "tags",
			id: doomed.id,
			overrideAccess: true,
		});

		const refreshed = await payload.findByID({
			collection: "posts",
			id: post.id,
			draft: true,
			overrideAccess: true,
			depth: 0,
		});

		expect(
			(refreshed["tags"] as (number | string)[] | undefined) ?? [],
		).not.toContain(doomed.id);
	});
});
