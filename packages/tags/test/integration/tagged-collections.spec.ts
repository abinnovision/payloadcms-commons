import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootPayload } from "./helpers/payload.js";

import type { Payload } from "payload";

type Id = number | string;

describe("tagged collections", () => {
	let payload: Payload;

	const createTag = async (name: string): Promise<Id> =>
		(
			await payload.create({
				collection: "tags",
				data: { name },
				overrideAccess: true,
			})
		).id;

	const deleteTag = (id: Id) =>
		payload.delete({ collection: "tags", id, overrideAccess: true });

	beforeAll(async () => {
		payload = await bootPayload();
	});

	afterAll(async () => {
		await payload.destroy();
	});

	it.each(["posts", "pages"])(
		"appends a sidebar hasMany relationship to %s",
		(slug) => {
			const field = payload.collections[slug]!.config.fields.find(
				(candidate) => "name" in candidate && candidate.name === "tags",
			);

			expect(field).toMatchObject({
				type: "relationship",
				relationTo: "tags",
				hasMany: true,
				admin: { position: "sidebar" },
			});
		},
	);

	it("filters documents with `where: { tags: { in } }`", async () => {
		const tagId = await createTag("Filter");
		const tagged = await payload.create({
			collection: "pages",
			data: { title: "Tagged", tags: [tagId] },
			overrideAccess: true,
		});
		await payload.create({
			collection: "pages",
			data: { title: "Untagged" },
			overrideAccess: true,
		});

		const found = await payload.find({
			collection: "pages",
			where: { tags: { in: [tagId] } },
			overrideAccess: true,
		});

		expect(found.docs.map((doc) => doc.id)).toEqual([tagged.id]);
	});

	it("removes a deleted tag from a published document", async () => {
		const tagId = await createTag("Doomed");
		const post = await payload.create({
			collection: "posts",
			data: { title: "Published post", tags: [tagId], _status: "published" },
			overrideAccess: true,
			draft: false,
		});

		await deleteTag(tagId);

		const refreshed = await payload.findByID({
			collection: "posts",
			id: post.id,
			overrideAccess: true,
			depth: 0,
		});

		expect(refreshed["tags"] ?? []).not.toContain(tagId);
	});

	it("removes a deleted tag from a draft version (`_posts_v_rels`)", async () => {
		const tagId = await createTag("Doomed Draft");
		const post = await payload.create({
			collection: "posts",
			data: { title: "Draft post", tags: [tagId] },
			draft: true,
			overrideAccess: true,
		});

		await deleteTag(tagId);

		const refreshed = await payload.findByID({
			collection: "posts",
			id: post.id,
			draft: true,
			overrideAccess: true,
			depth: 0,
		});

		expect(refreshed["tags"] ?? []).not.toContain(tagId);
	});
});
