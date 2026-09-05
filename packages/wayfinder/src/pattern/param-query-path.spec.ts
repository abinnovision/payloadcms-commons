import { describe, expect, it } from "vitest";

import { resolveParamQueryPath } from "./param-query-path.js";
import { resolveCollectionMapping } from "./resolver.js";

import type { RegisteredCollections } from "./param-query-path.js";
import type { SanitizedCollectionConfig } from "payload";

interface FieldStub {
	name: string;
	type: string;
	relationTo?: string | string[];
}

/** The narrow slice of a sanitized collection this module actually reads. */
const config = (slug: string, fields: FieldStub[]): SanitizedCollectionConfig =>
	({ slug, flattenedFields: fields }) as unknown as SanitizedCollectionConfig;

const registered = (
	...configs: SanitizedCollectionConfig[]
): RegisteredCollections =>
	Object.fromEntries(configs.map((it) => [it.slug, { config: it }]));

const map = (collection: string, path: string | Record<string, string>) =>
	resolveCollectionMapping({ collection, path });

const articles = config("articles", [
	{ name: "slug", type: "text" },
	{ name: "section", type: "relationship", relationTo: "sections" },
	{ name: "owner", type: "relationship", relationTo: ["sections", "notes"] },
]);

describe("resolveParamQueryPath", () => {
	it("filters a plain field on itself", () => {
		expect(
			resolveParamQueryPath({
				config: articles,
				param: "slug",
				collections: registered(articles),
			}),
		).toEqual({ queryPath: "slug" });
	});

	it("reports a parameter the collection has no field for", () => {
		const result = resolveParamQueryPath({
			config: articles,
			param: "kennung",
			collections: registered(articles),
		});

		expect(result).toHaveProperty("error");
		expect((result as { error: string }).error).toContain("kennung");
	});

	/*
	 * The last parameter of the pattern a collection is served at is, by
	 * definition, what identifies its documents — so a project keyed by
	 * `permalink` needs no configuration to be linked to.
	 */
	it("derives a relationship's identifier from the target's own pattern", () => {
		const sections = config("sections", [{ name: "permalink", type: "text" }]);

		expect(
			resolveParamQueryPath({
				config: articles,
				param: "section",
				collections: registered(articles, sections),
				mappings: [map("sections", "/archive/:permalink")],
				locale: "en",
			}),
		).toEqual({ queryPath: "section.permalink" });
	});

	/*
	 * A wildcard's stored value carries a leading slash while the value coming
	 * out of a match is a bare segment, so a query built from it would silently
	 * return nothing. The configured identifier field is used instead.
	 */
	it("falls back to the identifier field for a wildcard-mapped target", () => {
		const sections = config("sections", [
			{ name: "slug", type: "text" },
			{ name: "permalink", type: "text" },
		]);

		expect(
			resolveParamQueryPath({
				config: articles,
				param: "section",
				collections: registered(articles, sections),
				mappings: [map("sections", "/*permalink")],
				locale: "en",
			}),
		).toEqual({ queryPath: "section.slug" });
	});

	it("falls back to the identifier field when no mappings are supplied", () => {
		const sections = config("sections", [{ name: "slug", type: "text" }]);

		expect(
			resolveParamQueryPath({
				config: articles,
				param: "section",
				collections: registered(articles, sections),
			}),
		).toEqual({ queryPath: "section.slug" });
	});

	it("falls back to the identifier field when no locale is supplied", () => {
		const sections = config("sections", [
			{ name: "slug", type: "text" },
			{ name: "permalink", type: "text" },
		]);

		expect(
			resolveParamQueryPath({
				config: articles,
				param: "section",
				collections: registered(articles, sections),
				mappings: [map("sections", "/archive/:permalink")],
			}),
		).toEqual({ queryPath: "section.slug" });
	});

	it("honours a custom identifier field as the fallback", () => {
		const sections = config("sections", [{ name: "handle", type: "text" }]);

		expect(
			resolveParamQueryPath({
				config: articles,
				param: "section",
				collections: registered(articles, sections),
				fallbackIdentifierField: "handle",
			}),
		).toEqual({ queryPath: "section.handle" });
	});

	it("derives a different identifier per locale", () => {
		const sections = config("sections", [
			{ name: "permalink", type: "text" },
			{ name: "kennung", type: "text" },
		]);
		const mappings = [
			map("sections", { en: "/archive/:permalink", de: "/archiv/:kennung" }),
		];

		expect(
			resolveParamQueryPath({
				config: articles,
				param: "section",
				collections: registered(articles, sections),
				mappings,
				locale: "en",
			}),
		).toEqual({ queryPath: "section.permalink" });
		expect(
			resolveParamQueryPath({
				config: articles,
				param: "section",
				collections: registered(articles, sections),
				mappings,
				locale: "de",
			}),
		).toEqual({ queryPath: "section.kennung" });
	});

	/*
	 * One query path cannot express two identifier fields, so refusing here is
	 * better than silently matching on whichever target came first.
	 */
	it("refuses a polymorphic relationship whose targets disagree", () => {
		const sections = config("sections", [{ name: "permalink", type: "text" }]);
		const notes = config("notes", [{ name: "handle", type: "text" }]);

		const result = resolveParamQueryPath({
			config: articles,
			param: "owner",
			collections: registered(articles, sections, notes),
			mappings: [
				map("sections", "/archive/:permalink"),
				map("notes", "/notes/:handle"),
			],
			locale: "en",
		});

		expect(result).toHaveProperty("error");
		expect((result as { error: string }).error).toContain("permalink");
		expect((result as { error: string }).error).toContain("handle");
	});

	it("accepts a polymorphic relationship whose targets agree", () => {
		const sections = config("sections", [{ name: "permalink", type: "text" }]);
		const notes = config("notes", [{ name: "permalink", type: "text" }]);

		expect(
			resolveParamQueryPath({
				config: articles,
				param: "owner",
				collections: registered(articles, sections, notes),
				mappings: [
					map("sections", "/archive/:permalink"),
					map("notes", "/notes/:permalink"),
				],
				locale: "en",
			}),
		).toEqual({ queryPath: "owner.permalink" });
	});

	it("reports a target that has no field to match on", () => {
		const sections = config("sections", [{ name: "title", type: "text" }]);

		const result = resolveParamQueryPath({
			config: articles,
			param: "section",
			collections: registered(articles, sections),
		});

		expect(result).toHaveProperty("error");
		expect((result as { error: string }).error).toContain("sections");
		expect((result as { error: string }).error).toContain("slug");
	});

	it("reports a target that is not registered at all", () => {
		expect(
			resolveParamQueryPath({
				config: articles,
				param: "section",
				collections: registered(articles),
			}),
		).toHaveProperty("error");
	});
});
