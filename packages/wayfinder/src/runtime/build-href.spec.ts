import { describe, expect, it } from "vitest";

import { buildHref, identityFormatHref } from "./build-href.js";
import { defineMappings } from "../pattern/define-mappings.js";
import { matchCollectionMappings } from "../pattern/matcher.js";
import { resolveCollectionMapping } from "../pattern/resolver.js";

import type { Diagnostic, BuildDiagnosticReason } from "./diagnostics.js";

const map = (collection: string, path: string | Record<string, string>) =>
	resolveCollectionMapping({ collection, path });

const collectDiagnostics = () => {
	const seen: Diagnostic<BuildDiagnosticReason>[] = [];

	return {
		seen,
		onDiagnostic: (it: Diagnostic<BuildDiagnosticReason>) => void seen.push(it),
	};
};

describe("buildHref", () => {
	it("fills a pattern from a document's own fields", () => {
		expect(
			buildHref({
				mappings: [map("articles", "/journal/:slug")],
				collection: "articles",
				document: { slug: "hello-world" },
				locale: "en",
			}),
		).toBe("/journal/hello-world");
	});

	it("reads a populated relationship's identifier field", () => {
		expect(
			buildHref({
				mappings: [map("articles", "/:section/:slug")],
				collection: "articles",
				document: { section: { id: "s1", slug: "legal" }, slug: "imprint" },
				locale: "en",
			}),
		).toBe("/legal/imprint");
	});

	/*
	 * Build and match must agree on which field identifies a related document,
	 * so the same override that `resolveParamQueryPath` filters on is read here.
	 */
	/*
	 * The asymmetry documented in limitations.md, pinned so it stays a known
	 * boundary rather than becoming a surprise. A path lookup derives the
	 * target's identifier from the target's own pattern; building an href
	 * cannot, because a populated relationship carries no record of the
	 * collection it came from. The two agree only when the fallback names the
	 * field the target is actually keyed by.
	 */
	it("cannot derive a target's identifier, so build and match can disagree", () => {
		const rows = [
			{ collection: "articles", path: "/:section/:slug" },
			{ collection: "sections", path: "/topic/:handle" },
		];
		const document = {
			slug: "first-look",
			section: { id: 1, slug: "insights", handle: "insights-hub" },
		};
		const href = (mappings: ReturnType<typeof defineMappings>) =>
			buildHref({ mappings, collection: "articles", document, locale: "en" });

		// `sections` is served at /topic/:handle, so a lookup matches on `handle`.
		expect(href(defineMappings(rows))).toBe("/insights/first-look");

		// Naming it is what makes the two directions agree.
		expect(
			href(defineMappings(rows, { fallbackIdentifierField: "handle" })),
		).toBe("/insights-hub/first-look");
	});

	it("reads a populated relationship by the mapping's fallback identifier", () => {
		expect(
			buildHref({
				mappings: defineMappings(
					[{ collection: "articles", path: "/:section/:slug" }],
					{ fallbackIdentifierField: "handle" },
				),
				collection: "articles",
				document: {
					section: { id: "s1", handle: "guides" },
					slug: "hello-world",
				},
				locale: "en",
			}),
		).toBe("/guides/hello-world");
	});

	it("applies the identity format when none is supplied", () => {
		expect(
			identityFormatHref({ path: "/journal/hello-world", locale: "en" }),
		).toBe("/journal/hello-world");
		expect(
			buildHref({
				mappings: [map("articles", "/journal/:slug")],
				collection: "articles",
				document: { slug: "hello-world" },
				locale: "en",
			}),
		).toBe("/journal/hello-world");
	});

	it("passes the built path and locale through `formatHref`", () => {
		expect(
			buildHref({
				mappings: [map("articles", "/journal/:slug")],
				collection: "articles",
				document: { slug: "hello-world" },
				locale: "de",
				formatHref: ({ path, locale }) => `/${locale}${path}`,
			}),
		).toBe("/de/journal/hello-world");
	});

	/*
	 * `compile` cannot express an empty wildcard, so the root is short-circuited
	 * — but it still has to go through `formatHref`, or the home page would be
	 * the one path missing the locale and preview prefixes.
	 */
	it("routes the root wildcard through `formatHref` too", () => {
		expect(
			buildHref({
				mappings: [map("pages", "/*permalink")],
				collection: "pages",
				document: { permalink: "/" },
				locale: "en",
				formatHref: ({ path }) => `/preview${path}`,
			}),
		).toBe("/preview/");
	});

	it("returns the bare root for a root wildcard with the default format", () => {
		expect(
			buildHref({
				mappings: [map("pages", "/*permalink")],
				collection: "pages",
				document: { permalink: "/" },
				locale: "en",
			}),
		).toBe("/");
	});
});

describe("buildHref round trip", () => {
	it("round-trips a single-parameter pattern", () => {
		const mappings = [map("articles", "/journal/:slug")];
		const href = buildHref({
			mappings,
			collection: "articles",
			document: { slug: "hello-world" },
			locale: "en",
		});

		expect(
			matchCollectionMappings({
				path: href as string,
				locale: "en",
				mappings,
			})[0],
		).toMatchObject({
			identifier: { field: "slug", value: "hello-world" },
			scope: {},
		});
	});

	it("round-trips a multi-parameter pattern including its scope", () => {
		const mappings = [map("articles", "/:section/:slug")];
		const href = buildHref({
			mappings,
			collection: "articles",
			document: { section: { id: "s1", slug: "legal" }, slug: "imprint" },
			locale: "en",
		});

		expect(href).toBe("/legal/imprint");
		expect(
			matchCollectionMappings({
				path: href as string,
				locale: "en",
				mappings,
			})[0],
		).toMatchObject({
			identifier: { field: "slug", value: "imprint" },
			scope: { section: "legal" },
		});
	});

	it("round-trips a wildcard's full stored path", () => {
		const mappings = [map("pages", "/*permalink")];
		const href = buildHref({
			mappings,
			collection: "pages",
			document: { permalink: "/about/team" },
			locale: "en",
		});

		expect(href).toBe("/about/team");
		expect(
			matchCollectionMappings({
				path: href as string,
				locale: "en",
				mappings,
			})[0],
		).toMatchObject({
			identifier: { field: "permalink", value: "/about/team" },
			scope: {},
		});
	});

	/*
	 * A wildcard is built segment by segment and each segment is percent
	 * encoded, so a non-ASCII slug only survives if the split, encode, decode
	 * and join all agree.
	 */
	it("round-trips a non-ASCII slug through the wildcard path", () => {
		const mappings = [map("pages", "/*permalink")];
		const href = buildHref({
			mappings,
			collection: "pages",
			document: { permalink: "/über/uns" },
			locale: "en",
		});

		expect(href).toBe("/%C3%BCber/uns");
		expect(
			matchCollectionMappings({
				path: href as string,
				locale: "en",
				mappings,
			})[0],
		).toMatchObject({
			identifier: { field: "permalink", value: "/über/uns" },
			scope: {},
		});
	});
});

describe("buildHref diagnostics", () => {
	it("reports `no-mapping` for an unmapped collection", () => {
		const { seen, onDiagnostic } = collectDiagnostics();

		expect(
			buildHref({
				mappings: [map("articles", "/journal/:slug")],
				collection: "notes",
				document: { slug: "hello-world" },
				locale: "en",
				onDiagnostic,
			}),
		).toBeNull();
		expect(seen).toEqual([{ reason: "no-mapping", collection: "notes" }]);
	});

	it("reports `no-locale-pattern` when the locale has no pattern", () => {
		const { seen, onDiagnostic } = collectDiagnostics();

		expect(
			buildHref({
				mappings: [map("articles", { de: "/tagebuch/:slug" })],
				collection: "articles",
				document: { slug: "hello-world" },
				locale: "en",
				onDiagnostic,
			}),
		).toBeNull();
		expect(seen).toEqual([
			{ reason: "no-locale-pattern", collection: "articles", locale: "en" },
		]);
	});

	// The usual cause is a relationship left unpopulated by `defaultPopulate`.
	it("reports `missing-param` and names the parameter", () => {
		const { seen, onDiagnostic } = collectDiagnostics();

		expect(
			buildHref({
				mappings: [map("articles", "/:section/:slug")],
				collection: "articles",
				document: { slug: "imprint" },
				locale: "en",
				onDiagnostic,
			}),
		).toBeNull();
		expect(seen).toEqual([
			{ reason: "missing-param", collection: "articles", param: "section" },
		]);
	});

	it("reports `missing-param` for a relationship left as a bare id", () => {
		const { seen, onDiagnostic } = collectDiagnostics();

		expect(
			buildHref({
				mappings: [map("articles", "/:section/:slug")],
				collection: "articles",
				document: { section: { id: "s1" }, slug: "imprint" },
				locale: "en",
				onDiagnostic,
			}),
		).toBeNull();
		expect(seen[0]?.reason).toBe("missing-param");
	});

	it("stays silent and returns a path on the happy path", () => {
		const { seen, onDiagnostic } = collectDiagnostics();

		buildHref({
			mappings: [map("articles", "/journal/:slug")],
			collection: "articles",
			document: { slug: "hello-world" },
			locale: "en",
			onDiagnostic,
		});

		expect(seen).toEqual([]);
	});
});

describe("buildHref alongside a router that prefixes the locale", () => {
	/*
	 * next-intl's Link and anything like it add the locale themselves, so a
	 * package that also added one would emit `/de/de/about`. The default is
	 * therefore to return the path untouched and let exactly one layer own the
	 * prefix.
	 */
	const mappings = [
		resolveCollectionMapping({
			collection: "articles",
			path: { de: "/journal/:slug", en: "/journal/:slug" },
		}),
	];

	it("emits an unprefixed path by default", () => {
		expect(
			buildHref({
				mappings,
				collection: "articles",
				document: { slug: "hello-world" },
				locale: "de",
			}),
		).toBe("/journal/hello-world");
	});

	it("prefixes only where asked, for sitemaps and feeds", () => {
		expect(
			buildHref({
				mappings,
				collection: "articles",
				document: { slug: "hello-world" },
				locale: "de",
				formatHref: ({ path, locale }) => `/${locale}${path}`,
			}),
		).toBe("/de/journal/hello-world");
	});

	it("serves a different pattern per locale", () => {
		/*
		 * A localized site routes its own words: the pattern is per locale, so
		 * the same document is reachable at a translated path.
		 */
		const localized = [
			resolveCollectionMapping({
				collection: "articles",
				path: { de: "/tagebuch/:slug", en: "/journal/:slug" },
			}),
		];

		const args = {
			mappings: localized,
			collection: "articles",
			document: { slug: "hello-world" },
		};

		expect(buildHref({ ...args, locale: "de" })).toBe("/tagebuch/hello-world");
		expect(buildHref({ ...args, locale: "en" })).toBe("/journal/hello-world");
	});
});
