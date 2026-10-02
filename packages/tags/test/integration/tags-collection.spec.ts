import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { bootPayload } from "./helpers/payload.js";
import { colorForName } from "../../src/index.js";

import type { Payload } from "payload";

/** The `ValidationError` the duplicate-name hook throws. */
const duplicateName = {
	data: {
		errors: [
			{ path: "name", message: expect.stringMatching(/already exists/) },
		],
	},
};

describe("generated tags collection", () => {
	let payload: Payload;

	const createTag = (data: Record<string, unknown>) =>
		payload.create({ collection: "tags", data, overrideAccess: true });

	beforeAll(async () => {
		payload = await bootPayload();
	});

	afterAll(async () => {
		await payload.destroy();
	});

	it("fills a missing color with the deterministic default", async () => {
		const tag = await createTag({ name: "Announcements" });

		expect(tag["color"]).toBe(colorForName("Announcements"));
	});

	it("rejects a case-insensitive duplicate on create", async () => {
		await createTag({ name: "news" });

		await expect(createTag({ name: "NEWS" })).rejects.toMatchObject(
			duplicateName,
		);
	});

	it("rejects renaming a tag into a case-insensitive collision", async () => {
		await createTag({ name: "Existing" });
		const tag = await createTag({ name: "Other" });

		await expect(
			payload.update({
				collection: "tags",
				id: tag.id,
				data: { name: "EXISTING" },
				overrideAccess: true,
			}),
		).rejects.toMatchObject(duplicateName);
	});

	it("allows renaming a tag's own casing", async () => {
		const tag = await createTag({ name: "Weather" });

		const updated = await payload.update({
			collection: "tags",
			id: tag.id,
			data: { name: "WEATHER" },
			overrideAccess: true,
		});

		expect(updated["name"]).toBe("WEATHER");
	});

	it("keeps a custom color when a partial update omits it", async () => {
		const tag = await createTag({ name: "Custom Color", color: "#123456" });

		const updated = await payload.update({
			collection: "tags",
			id: tag.id,
			data: { name: "Renamed" },
			overrideAccess: true,
		});

		expect(updated["color"]).toBe("#123456");
	});

	it("rejects an exact duplicate through the unique index", async () => {
		// The database adapter skips the hooks, so only the index can refuse it.
		await payload.db.create({ collection: "tags", data: { name: "Indexed" } });

		await expect(
			payload.db.create({ collection: "tags", data: { name: "Indexed" } }),
		).rejects.toThrow();
	});
});
