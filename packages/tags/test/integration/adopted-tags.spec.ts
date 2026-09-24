import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootPayload, USER } from "./helpers/payload.js";
import { colorForName } from "../../src/index.js";

import type { Payload } from "payload";

describe("adopted tags collection", () => {
	let payload: Payload;
	let userId: number | string;

	beforeAll(async () => {
		payload = await bootPayload("tags-adopted");

		const user = await payload.create({ collection: "users", data: USER });
		userId = user.id;
	});

	afterAll(async () => {
		await payload.destroy();
	});

	it("fills a missing color with the deterministic default", async () => {
		const tag = await payload.create({
			collection: "tags",
			data: { title: "Announcements" },
			overrideAccess: true,
		});

		expect(tag["color"]).toBe(colorForName("Announcements"));
	});

	it("keeps the project's own access rule: create is refused without a user", async () => {
		await expect(
			payload.create({
				collection: "tags",
				data: { title: "Denied" },
				overrideAccess: false,
				user: undefined,
			}),
		).rejects.toThrow();
	});

	it("still runs the project's own beforeChange hook alongside the plugin's", async () => {
		const tag = await payload.create({
			collection: "tags",
			data: { title: "Roadmap" },
			overrideAccess: true,
			user: { id: userId, collection: "users" },
		});

		expect(tag["flagged"]).toBe(true);
	});

	it("rejects a case-insensitive duplicate on create", async () => {
		await payload.create({
			collection: "tags",
			data: { title: "news" },
			overrideAccess: true,
		});

		await expect(
			payload.create({
				collection: "tags",
				data: { title: "NEWS" },
				overrideAccess: true,
			}),
		).rejects.toThrow();
	});

	it("keeps a pre-existing case-insensitive duplicate pair editable", async () => {
		/*
		 * Written through the database adapter directly, bypassing the
		 * collection's hooks, to stand in for a pair that existed before the
		 * plugin's duplicate check was ever installed.
		 */
		const original = await payload.db.create({
			collection: "tags",
			data: { title: "Update", flagged: true },
		});
		await payload.db.create({
			collection: "tags",
			data: { title: "update", flagged: true },
		});

		const updated = await payload.update({
			collection: "tags",
			id: original.id as number | string,
			/*
			 * The title is resubmitted unchanged, which is exactly the update the
			 * duplicate check must not trip over given a pre-existing duplicate.
			 */
			data: { title: "Update" },
			overrideAccess: true,
		});

		expect(updated["title"]).toBe("Update");
	});

	it("rejects renaming a tag into a case-insensitive collision with another tag", async () => {
		await payload.create({
			collection: "tags",
			data: { title: "Existing" },
			overrideAccess: true,
		});
		const tag = await payload.create({
			collection: "tags",
			data: { title: "Other" },
			overrideAccess: true,
		});

		await expect(
			payload.update({
				collection: "tags",
				id: tag.id,
				data: { title: "EXISTING" },
				overrideAccess: true,
			}),
		).rejects.toThrow();
	});

	it("allows renaming a tag's own casing", async () => {
		const tag = await payload.create({
			collection: "tags",
			data: { title: "Weather" },
			overrideAccess: true,
		});

		const updated = await payload.update({
			collection: "tags",
			id: tag.id,
			data: { title: "WEATHER" },
			overrideAccess: true,
		});

		expect(updated["title"]).toBe("WEATHER");
	});

	it("keeps a custom color when a partial update omits it", async () => {
		const tag = await payload.create({
			collection: "tags",
			data: { title: "Custom Color", color: "#123456" },
			overrideAccess: true,
		});

		const updated = await payload.update({
			collection: "tags",
			id: tag.id,
			data: { title: "Renamed" },
			overrideAccess: true,
		});

		expect(updated["color"]).toBe("#123456");
	});

	it("reads a row with an explicit null color without failing", async () => {
		const seeded = await payload.db.create({
			collection: "tags",
			data: { title: "Neutral", color: null },
		});

		const found = await payload.findByID({
			collection: "tags",
			id: seeded.id as number | string,
			overrideAccess: true,
		});

		expect(found["title"]).toBe("Neutral");
	});
});
