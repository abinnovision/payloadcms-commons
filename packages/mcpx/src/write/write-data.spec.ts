import { beforeAll, describe, expect, it } from "vitest";

import { buildWriteData } from "./write-data.js";
import { buildFixtureConfig } from "../../test/fixtures/config.js";
import { schemaOf } from "../schema/walk.js";

import type { SanitizedConfig } from "payload";

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

describe("buildWriteData", () => {
	let config: SanitizedConfig;

	beforeAll(async () => {
		config = await buildFixtureConfig();
	});

	it("keeps describable fields and row identity, drops what Payload owns", () => {
		const data = buildWriteData(
			config,
			schemaOf(config, { kind: "collection", slug: "pages" }),
			{
				...DOC,
				_status: "draft",
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-01T00:00:00.000Z",
				unknown: "x",
				meta: { title: "Meta", stray: true },
			},
		);

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

	it("drops the base fields of an upload document", () => {
		const data = buildWriteData(
			config,
			schemaOf(config, { kind: "collection", slug: "media" }),
			{
				id: "m1",
				alt: "A cat",
				credit: "Nobody",
				filename: "cat.png",
				mimeType: "image/png",
				filesize: 1234,
				width: 800,
				height: 600,
				url: "/media/cat.png",
				thumbnailURL: "https://example.test/media/cat.png",
				focalX: 50,
				focalY: 50,
			},
		);

		expect(data).toEqual({ alt: "A cat", credit: "Nobody" });
	});
});
