import { beforeAll, describe, expect, it } from "vitest";

import { bootPayload } from "./helpers/payload.js";
import {
	DEFAULT_MAPPING_GLOBAL_SLUG,
	loadMappings,
} from "../../src/config/index.js";
import { DEFAULT_LOCALE_KEY } from "../../src/pattern/index.js";
import { buildHref, resolvePathToDocument } from "../../src/runtime/index.js";

import type { PayloadCollectionMappingResolved } from "../../src/pattern/index.js";
import type { Payload } from "payload";

/*
 * A project with no `localization` block gets a scalar `path` back from
 * Payload rather than a per-locale record. Nothing in a locale-seeded suite
 * can catch the difference, and the failure it hides is silent: a plain string
 * walked by `Object.entries` compiles into one nonsense resolver per
 * character, so every lookup simply stops matching.
 */
describe("wayfinder against a Payload instance with no localization", () => {
	// Any string works as the locale: the unlocalized bucket is the fallback.
	const locale = "whatever";

	let payload: Payload;
	let mappings: PayloadCollectionMappingResolved[];
	let articleId: string;
	let pageId: string;

	beforeAll(async () => {
		payload = await bootPayload({
			key: "wayfinder-no-locale",
			localized: false,
		});

		const section = await payload.create({
			collection: "sections",
			data: { title: "Field Notes", slug: "field-notes", handle: "fn" },
		});

		const article = await payload.create({
			collection: "articles",
			data: { title: "Second Look", slug: "second-look", section: section.id },
		});
		articleId = String(article.id);

		const page = await payload.create({
			collection: "pages",
			data: { title: "Imprint", slug: "/legal/imprint", _status: "published" },
		});
		pageId = String(page.id);

		await payload.updateGlobal({
			slug: DEFAULT_MAPPING_GLOBAL_SLUG,
			data: {
				collections: [
					{ collectionName: "pages", path: "/*slug" },
					{ collectionName: "articles", path: "/:section/:slug" },
					{ collectionName: "sections", path: "/topic/:slug" },
				],
			},
		});

		mappings = await loadMappings({ payload, localized: false });
	});

	it("normalises a scalar path into the single unlocalized bucket", () => {
		const pages = mappings.find((it) => it.collection === "pages");

		// One bucket with the whole pattern in it, not one per character.
		expect(pages?.path).toEqual({ [DEFAULT_LOCALE_KEY]: "/*slug" });
		expect(Object.keys(pages?.resolvers ?? {})).toEqual([DEFAULT_LOCALE_KEY]);
		expect(pages?.resolvers[DEFAULT_LOCALE_KEY]?.paramNames).toEqual(["slug"]);
	});

	it("resolves a page path", async () => {
		const resolved = await resolvePathToDocument({
			payload,
			mappings,
			path: "/legal/imprint",
			locale,
		});

		expect(resolved?.collection).toBe("pages");
		expect(String(resolved?.document.id)).toBe(pageId);
	});

	it("resolves a section-scoped article path", async () => {
		const resolved = await resolvePathToDocument({
			payload,
			mappings,
			path: "/field-notes/second-look",
			locale,
		});

		expect(resolved?.collection).toBe("articles");
		expect(String(resolved?.document.id)).toBe(articleId);
	});

	it("round-trips both collections back to the paths they were found at", async () => {
		const page = await payload.findByID({ collection: "pages", id: pageId });
		const article = await payload.findByID({
			collection: "articles",
			id: articleId,
			depth: 1,
		});

		expect(
			buildHref({ mappings, collection: "pages", document: page, locale }),
		).toBe("/legal/imprint");
		expect(
			buildHref({
				mappings,
				collection: "articles",
				document: article,
				locale,
			}),
		).toBe("/field-notes/second-look");
	});
});
