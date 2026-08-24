import { getLocalI18n } from "payload";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { collectPublishBlockers } from "./publish-blockers.js";
import { buildFixtureConfig } from "../../test/fixtures/config.js";

import type {
	Field,
	PayloadRequest,
	SanitizedCollectionConfig,
	SanitizedConfig,
} from "payload";

const paragraph = (text: string) => ({
	root: {
		type: "root",
		children: [
			{
				type: "paragraph",
				children: [{ type: "text", text, version: 1 }],
				direction: null,
				format: "",
				indent: 0,
				version: 1,
			},
		],
		direction: null,
		format: "",
		indent: 0,
		version: 1,
	},
});

let config: SanitizedConfig;
let pages: SanitizedCollectionConfig;
let warn: ReturnType<typeof vi.fn>;
let req: PayloadRequest;

/**
 * The slice of a request the field traversals read: the payload instance for
 * config, blocks and collections, i18n for labels, and a locale.
 */
const createReq = async (
	sanitized: SanitizedConfig,
): Promise<PayloadRequest> => {
	const i18n = await getLocalI18n({ config: sanitized, language: "en" });

	return {
		context: {},
		i18n,
		locale: "en",
		payload: {
			blocks: Object.fromEntries(
				(sanitized.blocks ?? []).map((block) => [block.slug, block]),
			),
			collections: Object.fromEntries(
				sanitized.collections.map((collection) => [
					collection.slug,
					{ config: collection },
				]),
			),
			config: sanitized,
			logger: { warn },
		},
		t: i18n.t,
		user: null,
	} as unknown as PayloadRequest;
};

beforeAll(async () => {
	config = await buildFixtureConfig();
	pages = config.collections.find((candidate) => candidate.slug === "pages")!;
	warn = vi.fn();
	req = await createReq(config);
});

describe("collectPublishBlockers", () => {
	it("reports the required fields a draft is still missing", async () => {
		const blockers = await collectPublishBlockers(req, {
			collection: pages,
			doc: { id: "p1", layout: { color: "light" } },
		});

		expect(blockers.map((blocker) => blocker.path).sort()).toEqual([
			"/layout/sections",
			"/slug",
			"/title",
		]);
		expect(blockers[0]).toMatchObject({
			field: expect.any(String),
			message: expect.any(String),
		});
	});

	it("reports a required field inside a block with its label path", async () => {
		const blockers = await collectPublishBlockers(req, {
			collection: pages,
			doc: {
				id: "p1",
				title: "Home",
				slug: "home",
				layout: {
					sections: [
						{
							blockType: "sectionWrapper",
							modules: [{ blockType: "hero", imageSize: "small" }],
						},
					],
				},
			},
		});

		expect(blockers).toEqual([
			expect.objectContaining({
				path: "/layout/sections/0/modules/0/title",
				field: expect.stringContaining("Title"),
			}),
		]);
	});

	it("reports nothing for a draft that could be published", async () => {
		const blockers = await collectPublishBlockers(req, {
			collection: pages,
			doc: {
				id: "p1",
				title: "Home",
				slug: "home",
				layout: {
					sections: [
						{
							blockType: "sectionWrapper",
							modules: [
								{
									blockType: "hero",
									title: paragraph("Hello"),
									imageSize: "small",
								},
							],
						},
					],
				},
			},
		});

		expect(blockers).toEqual([]);
	});

	it("returns nothing and warns when the traversal itself fails", async () => {
		const fields: Field[] = [
			{
				name: "boom",
				type: "text",
				hooks: {
					beforeChange: [
						() => {
							throw new Error("hook exploded");
						},
					],
				},
			},
		];
		const broken: SanitizedCollectionConfig = { ...pages, fields };

		const blockers = await collectPublishBlockers(req, {
			collection: broken,
			doc: { id: "p1", boom: "x" },
		});

		expect(blockers).toEqual([]);
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining("Could not validate the pages draft"),
		);
	});
});
