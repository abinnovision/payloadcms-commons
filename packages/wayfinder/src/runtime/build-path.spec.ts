import { describe, expect, it } from "vitest";

import { buildPath } from "./build-path.js";
import { resolveCollectionMapping } from "../pattern/resolver.js";

import type { BuildDiagnosticReason, Diagnostic } from "./diagnostics.js";

const map = (collection: string, path: string | Record<string, string>) =>
	resolveCollectionMapping({ collection, path });

const collectDiagnostics = () => {
	const seen: Diagnostic<BuildDiagnosticReason>[] = [];

	return {
		seen,
		onDiagnostic: (it: Diagnostic<BuildDiagnosticReason>) => void seen.push(it),
	};
};

describe("buildPath", () => {
	/*
	 * Positional values let a sitemap fill a pattern without knowing what its
	 * parameters are called, so renaming one in the CMS needs no code change.
	 */
	it("fills a pattern positionally from an array", () => {
		expect(
			buildPath({
				mappings: [map("articles", "/:section/:slug")],
				collection: "articles",
				locale: "en",
				values: ["legal", "imprint"],
			}),
		).toBe("/legal/imprint");
	});

	it("fills a pattern by name from a record", () => {
		expect(
			buildPath({
				mappings: [map("articles", "/:section/:slug")],
				collection: "articles",
				locale: "en",
				values: { slug: "imprint", section: "legal" },
			}),
		).toBe("/legal/imprint");
	});

	it("builds a wildcard from its stored full path", () => {
		expect(
			buildPath({
				mappings: [map("pages", "/*permalink")],
				collection: "pages",
				locale: "en",
				values: ["/about/team"],
			}),
		).toBe("/about/team");
	});

	it("passes the built path through `formatHref`", () => {
		expect(
			buildPath({
				mappings: [map("articles", "/journal/:slug")],
				collection: "articles",
				locale: "de",
				values: ["hello-world"],
				formatHref: ({ path, locale }) => `/${locale}${path}`,
			}),
		).toBe("/de/journal/hello-world");
	});
});

describe("buildPath fallbacks", () => {
	/*
	 * Emitting a bare root into a feed is recoverable; emitting an empty href
	 * is not. The fallback still goes through `formatHref` so it lands inside
	 * whatever prefix the rest of the feed uses.
	 */
	it("falls back to the site root for an unmapped collection", () => {
		expect(
			buildPath({
				mappings: [map("articles", "/journal/:slug")],
				collection: "notes",
				locale: "en",
				values: ["hello-world"],
			}),
		).toBe("/");
	});

	it("prefixes the unmapped fallback with `formatHref`", () => {
		expect(
			buildPath({
				mappings: [map("articles", "/journal/:slug")],
				collection: "notes",
				locale: "en",
				values: ["hello-world"],
				formatHref: ({ path, locale }) => `/${locale}${path}`,
			}),
		).toBe("/en/");
	});

	it("falls back to the site root when the locale has no pattern", () => {
		expect(
			buildPath({
				mappings: [map("articles", { de: "/tagebuch/:slug" })],
				collection: "articles",
				locale: "en",
				values: ["hello-world"],
				formatHref: ({ path }) => `/preview${path}`,
			}),
		).toBe("/preview/");
	});

	it("falls back to the site root for a root wildcard value", () => {
		expect(
			buildPath({
				mappings: [map("pages", "/*permalink")],
				collection: "pages",
				locale: "en",
				values: ["/"],
			}),
		).toBe("/");
	});

	it("prefixes the root wildcard fallback with `formatHref`", () => {
		expect(
			buildPath({
				mappings: [map("pages", "/*permalink")],
				collection: "pages",
				locale: "en",
				values: ["/"],
				formatHref: ({ path }) => `/preview${path}`,
			}),
		).toBe("/preview/");
	});

	it("treats a missing wildcard value as the root", () => {
		expect(
			buildPath({
				mappings: [map("pages", "/*permalink")],
				collection: "pages",
				locale: "en",
				values: [],
			}),
		).toBe("/");
	});

	it("reports why it fell back", () => {
		const { seen, onDiagnostic } = collectDiagnostics();

		buildPath({
			mappings: [map("articles", { de: "/tagebuch/:slug" })],
			collection: "notes",
			locale: "en",
			values: [],
			onDiagnostic,
		});
		buildPath({
			mappings: [map("articles", { de: "/tagebuch/:slug" })],
			collection: "articles",
			locale: "en",
			values: [],
			onDiagnostic,
		});

		expect(seen).toEqual([
			{ reason: "no-mapping", collection: "notes" },
			{ reason: "no-locale-pattern", collection: "articles", locale: "en" },
		]);
	});
});

describe("buildPath with a missing value", () => {
	const mappings = [map("articles", "/:section/:slug")];

	/*
	 * `compile` accepts an empty string and drops the segment, so a missing
	 * value used to produce "//hello". That is protocol-relative: made
	 * absolute for a sitemap or a feed it points at a different host, which is
	 * a worse failure than the site root this returns instead.
	 */
	it("falls back to the root rather than building a protocol-relative path", () => {
		expect(
			buildPath({
				mappings,
				collection: "articles",
				locale: "en",
				values: ["", "hello-world"],
			}),
		).toBe("/");
	});

	it("names the parameter that had no value", () => {
		const seen: Diagnostic<BuildDiagnosticReason>[] = [];

		buildPath({
			mappings,
			collection: "articles",
			locale: "en",
			values: { slug: "hello-world" },
			onDiagnostic: (it) => seen.push(it),
		});

		expect(seen).toEqual([
			{ reason: "missing-param", collection: "articles", param: "section" },
		]);
	});
});
