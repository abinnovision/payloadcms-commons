import { describe, expect, it } from "vitest";

import {
	isRootWildcard,
	resolveCollectionMapping,
	resolversFor,
} from "./resolver.js";
import { DEFAULT_LOCALE_KEY } from "./types.js";

describe("resolveCollectionMapping", () => {
	it("compiles one resolver per locale for a per-locale record", () => {
		const mapping = resolveCollectionMapping({
			collection: "articles",
			path: { en: "/journal/:slug", de: "/tagebuch/:slug" },
		});

		expect(Object.keys(mapping.resolvers).sort()).toEqual(["de", "en"]);
		expect(mapping.resolvers["en"]?.build({ slug: "hello-world" })).toBe(
			"/journal/hello-world",
		);
		expect(mapping.resolvers["de"]?.build({ slug: "hello-world" })).toBe(
			"/tagebuch/hello-world",
		);
	});

	/*
	 * A project with no `localization` block gets a plain string back from
	 * Payload. Walking it with `Object.entries` would treat every character as
	 * a locale, so the string has to be normalised into a single bucket first.
	 */
	it("compiles exactly one resolver for a scalar path", () => {
		const mapping = resolveCollectionMapping({
			collection: "pages",
			path: "/journal/:slug",
		});

		expect(Object.keys(mapping.resolvers)).toEqual([DEFAULT_LOCALE_KEY]);
		expect(mapping.path).toEqual({ [DEFAULT_LOCALE_KEY]: "/journal/:slug" });
	});

	it("keeps the authored patterns on `path`", () => {
		const mapping = resolveCollectionMapping({
			collection: "articles",
			path: { en: "/journal/:slug" },
		});

		expect(mapping.collection).toBe("articles");
		expect(mapping.path).toEqual({ en: "/journal/:slug" });
	});
});

describe("resolversFor", () => {
	it("returns the requested locale's resolvers", () => {
		const mapping = resolveCollectionMapping({
			collection: "articles",
			path: { en: "/journal/:slug", de: "/tagebuch/:slug" },
		});

		expect(resolversFor(mapping, "de")?.build({ slug: "hello-world" })).toBe(
			"/tagebuch/hello-world",
		);
	});

	/*
	 * An unlocalized project has exactly one bucket, so callers may pass
	 * whatever locale they happen to hold and still get the right pattern.
	 */
	it("falls back to the default bucket when the locale is absent", () => {
		const mapping = resolveCollectionMapping({
			collection: "pages",
			path: "/journal/:slug",
		});

		expect(resolversFor(mapping, "en")?.build({ slug: "hello-world" })).toBe(
			"/journal/hello-world",
		);
	});

	it("returns undefined when neither the locale nor the default bucket exists", () => {
		const mapping = resolveCollectionMapping({
			collection: "articles",
			path: { de: "/tagebuch/:slug" },
		});

		expect(resolversFor(mapping, "en")).toBeUndefined();
	});
});

describe("wildcard normalisation", () => {
	const mapping = resolveCollectionMapping({
		collection: "pages",
		path: "/*permalink",
	});
	const resolvers = resolversFor(mapping, "en");

	/*
	 * A wildcard stands for a whole path, so its matched value is stored the
	 * way a full path is stored: with a leading slash.
	 */
	it("gives a matched wildcard value a leading slash", () => {
		expect(resolvers?.match("/about/team")).toEqual({
			identifier: { field: "permalink", value: "/about/team" },
			scope: {},
		});
	});

	it("accepts the stored leading-slash value back in `build`", () => {
		expect(resolvers?.build({ permalink: "/about/team" })).toBe("/about/team");
	});

	it("round-trips a single-segment wildcard value", () => {
		const built = resolvers?.build({ permalink: "/hello-world" });

		expect(built).toBe("/hello-world");
		expect(resolvers?.match(built as string)).toEqual({
			identifier: { field: "permalink", value: "/hello-world" },
			scope: {},
		});
	});

	it("does not add a leading slash to a non-wildcard parameter", () => {
		const plain = resolveCollectionMapping({
			collection: "articles",
			path: "/journal/:slug",
		});

		expect(resolversFor(plain, "en")?.match("/journal/hello-world")).toEqual({
			identifier: { field: "slug", value: "hello-world" },
			scope: {},
		});
	});
});

describe("isRootWildcard", () => {
	const wildcard = resolversFor(
		resolveCollectionMapping({ collection: "pages", path: "/*permalink" }),
		"en",
	);
	const plain = resolversFor(
		resolveCollectionMapping({
			collection: "articles",
			path: "/journal/:slug",
		}),
		"en",
	);

	it("is true when every wildcard value is the bare root", () => {
		expect(isRootWildcard(wildcard!, ["/"])).toBe(true);
	});

	it("is true when every wildcard value is empty", () => {
		expect(isRootWildcard(wildcard!, [""])).toBe(true);
	});

	it("is false when a wildcard value names a real path", () => {
		expect(isRootWildcard(wildcard!, ["/about/team"])).toBe(false);
	});

	it("is false for a pattern with no wildcard at all", () => {
		expect(isRootWildcard(plain!, ["/"])).toBe(false);
	});
});

describe("specificity", () => {
	const specificityOf = (pattern: string) =>
		resolversFor(
			resolveCollectionMapping({ collection: "pages", path: pattern }),
			"en",
		)?.specificity;

	it("counts literal segments and ignores parameters", () => {
		expect(specificityOf("/journal/:slug")).toEqual({
			literalSegments: 1,
			hasWildcard: false,
			totalSegments: 2,
		});
	});

	it("reports a bare wildcard as one non-literal segment", () => {
		expect(specificityOf("/*permalink")).toEqual({
			literalSegments: 0,
			hasWildcard: true,
			totalSegments: 1,
		});
	});

	it("counts every segment towards the total", () => {
		expect(specificityOf("/archive/:section/:slug")).toEqual({
			literalSegments: 1,
			hasWildcard: false,
			totalSegments: 3,
		});
	});

	it("treats an all-parameter pattern as having no literal segments", () => {
		expect(specificityOf("/:section/:slug")).toEqual({
			literalSegments: 0,
			hasWildcard: false,
			totalSegments: 2,
		});
	});
});

describe("paramNames", () => {
	it("lists parameters in pattern order, identifier last", () => {
		const mapping = resolveCollectionMapping({
			collection: "articles",
			path: "/:section/:slug",
		});

		expect(resolversFor(mapping, "en")?.paramNames).toEqual([
			"section",
			"slug",
		]);
	});
});

describe("match", () => {
	it("splits earlier parameters into `scope`", () => {
		const mapping = resolveCollectionMapping({
			collection: "articles",
			path: "/:section/:slug",
		});

		expect(resolversFor(mapping, "en")?.match("/legal/hello-world")).toEqual({
			identifier: { field: "slug", value: "hello-world" },
			scope: { section: "legal" },
		});
	});

	it("returns false when the path does not fit the pattern", () => {
		const mapping = resolveCollectionMapping({
			collection: "articles",
			path: "/journal/:slug",
		});

		expect(resolversFor(mapping, "en")?.match("/notes/hello-world")).toBe(
			false,
		);
	});
});
