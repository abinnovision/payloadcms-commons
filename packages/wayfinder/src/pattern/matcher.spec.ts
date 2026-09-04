import { describe, expect, it } from "vitest";

import { matchCollectionMappings } from "./matcher.js";
import { resolveCollectionMapping } from "./resolver.js";

import type { PayloadCollectionMappingResolved } from "./types.js";

const map = (collection: string, path: string | Record<string, string>) =>
	resolveCollectionMapping({ collection, path });

const collectionsOf = (
	matches: { mapping: PayloadCollectionMappingResolved }[],
) => matches.map((it) => it.mapping.collection);

describe("matchCollectionMappings", () => {
	/*
	 * More than one pattern can legitimately own a path. Returning all of them
	 * lets a caller fall through to the next candidate when the first yields no
	 * document, rather than 404ing on a page that exists.
	 */
	it("returns every candidate, most specific first", () => {
		const matches = matchCollectionMappings({
			path: "/legal/imprint",
			locale: "en",
			mappings: [
				map("pages", "/*permalink"),
				map("articles", "/:section/:slug"),
			],
		});

		expect(collectionsOf(matches)).toEqual(["articles", "pages"]);
		expect(matches[0]).toMatchObject({
			identifier: { field: "slug", value: "imprint" },
			scope: { section: "legal" },
		});
		expect(matches[1]).toMatchObject({
			identifier: { field: "permalink", value: "/legal/imprint" },
			scope: {},
		});
	});

	it("orders a literal segment above a parameter", () => {
		const matches = matchCollectionMappings({
			path: "/journal/hello-world",
			locale: "en",
			mappings: [
				map("articles", "/:section/:slug"),
				map("notes", "/journal/:slug"),
			],
		});

		expect(collectionsOf(matches)).toEqual(["notes", "articles"]);
	});

	it("orders a fixed-arity pattern above a wildcard", () => {
		const matches = matchCollectionMappings({
			path: "/hello-world",
			locale: "en",
			mappings: [map("pages", "/*permalink"), map("articles", "/:slug")],
		});

		expect(collectionsOf(matches)).toEqual(["articles", "pages"]);
	});

	/*
	 * Two collections may legally hold the same pattern. Without a final
	 * tiebreak the winner would be whichever row an editor happened to drag
	 * higher in the admin panel, so ordering falls back to the collection name.
	 */
	it("breaks a tie by collection name, not by array order", () => {
		const notes = map("notes", "/:section/:slug");
		const articles = map("articles", "/:section/:slug");
		const args = { path: "/legal/imprint", locale: "en" };

		expect(
			collectionsOf(
				matchCollectionMappings({ ...args, mappings: [notes, articles] }),
			),
		).toEqual(["articles", "notes"]);
		expect(
			collectionsOf(
				matchCollectionMappings({ ...args, mappings: [articles, notes] }),
			),
		).toEqual(["articles", "notes"]);
	});

	/*
	 * path-to-regexp needs at least one segment for a wildcard, so `/` can
	 * never match one. The bare catch-all owns the root by rule instead.
	 */
	it("resolves the root through the bare-wildcard rule", () => {
		const matches = matchCollectionMappings({
			path: "/",
			locale: "en",
			mappings: [
				map("articles", "/journal/:slug"),
				map("pages", "/*permalink"),
			],
		});

		expect(matches).toHaveLength(1);
		expect(matches[0]?.mapping.collection).toBe("pages");
		expect(matches[0]?.identifier).toEqual({ field: "permalink", value: "/" });
		expect(matches[0]?.scope).toEqual({});
	});

	it("returns nothing for the root when no bare wildcard exists", () => {
		expect(
			matchCollectionMappings({
				path: "/",
				locale: "en",
				mappings: [map("articles", "/journal/:slug")],
			}),
		).toEqual([]);
	});

	it("ignores a wildcard that sits behind a literal segment when resolving the root", () => {
		expect(
			matchCollectionMappings({
				path: "/",
				locale: "en",
				mappings: [map("pages", "/archive/*permalink")],
			}),
		).toEqual([]);
	});

	it("skips a mapping with no pattern for the requested locale", () => {
		const matches = matchCollectionMappings({
			path: "/journal/hello-world",
			locale: "en",
			mappings: [
				map("notes", { de: "/tagebuch/:slug" }),
				map("articles", { en: "/journal/:slug" }),
			],
		});

		expect(collectionsOf(matches)).toEqual(["articles"]);
	});

	it("skips a locale-less mapping when resolving the root rather than throwing", () => {
		expect(() =>
			matchCollectionMappings({
				path: "/",
				locale: "en",
				mappings: [map("pages", { de: "/*permalink" })],
			}),
		).not.toThrow();
	});

	it("returns nothing when no pattern fits the path", () => {
		expect(
			matchCollectionMappings({
				path: "/journal/hello-world",
				locale: "en",
				mappings: [map("articles", "/archive/:section/:slug")],
			}),
		).toEqual([]);
	});
});
