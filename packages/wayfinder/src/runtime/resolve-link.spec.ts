import { describe, expect, it } from "vitest";

import { isAvailableLink, resolveLink } from "./resolve-link.js";
import { linkField } from "../config/link-field.js";
import { defineLinks } from "../pattern/define-links.js";
import { resolveCollectionMapping } from "../pattern/resolver.js";

import type { Diagnostic, ResolveLinkDiagnosticReason } from "./diagnostics.js";
import type {
	BaseResolvedLink,
	LinkVariant,
	ResolvedLink,
} from "../pattern/types.js";

const mappings = [
	resolveCollectionMapping({ collection: "articles", path: "/journal/:slug" }),
];

const collectDiagnostics = () => {
	const seen: Diagnostic<ResolveLinkDiagnosticReason>[] = [];

	return {
		seen,
		onDiagnostic: (it: Diagnostic<ResolveLinkDiagnosticReason>) =>
			void seen.push(it),
	};
};

describe("resolveLink", () => {
	it("returns null when there is no link at all", () => {
		expect(resolveLink({ link: undefined, mappings, locale: "en" })).toBeNull();
	});

	it("returns null for an explicit `none`", () => {
		expect(
			resolveLink({ link: { type: "none" }, mappings, locale: "en" }),
		).toBeNull();
	});

	it("returns null for a type that was never set", () => {
		expect(
			resolveLink({ link: { label: "Read on" }, mappings, locale: "en" }),
		).toBeNull();
	});

	it("returns a custom URL untouched", () => {
		expect(
			resolveLink({
				link: { type: "custom", url: "https://example.com" },
				mappings,
				locale: "en",
			}),
		).toEqual({ href: "https://example.com" });
	});

	it("returns null for a custom link with no URL", () => {
		expect(
			resolveLink({ link: { type: "custom" }, mappings, locale: "en" }),
		).toBeNull();
	});

	it("prefixes a same-page identifier with a hash", () => {
		expect(
			resolveLink({
				link: { type: "same-page", samePageIdentifier: "contact" },
				mappings,
				locale: "en",
			}),
		).toEqual({ href: "#contact" });
	});

	it("returns null for a same-page link with no identifier", () => {
		expect(
			resolveLink({ link: { type: "same-page" }, mappings, locale: "en" }),
		).toBeNull();
	});

	it("adds the safe new-tab attributes when asked", () => {
		expect(
			resolveLink({
				link: { type: "custom", url: "https://example.com", newTab: true },
				mappings,
				locale: "en",
			}),
		).toEqual({
			href: "https://example.com",
			target: "_blank",
			rel: "noopener noreferrer",
		});
	});

	it("omits the new-tab attributes for a same-page link", () => {
		expect(
			resolveLink({
				link: {
					type: "same-page",
					samePageIdentifier: "contact",
					newTab: true,
				},
				mappings,
				locale: "en",
			}),
		).toEqual({ href: "#contact" });
	});
});

describe("resolveLink references", () => {
	it("routes a populated reference through its collection mapping", () => {
		expect(
			resolveLink({
				link: {
					type: "reference",
					reference: {
						relationTo: "articles",
						value: { id: "a1", slug: "hello-world" },
					},
				},
				mappings,
				locale: "en",
			}),
		).toEqual({ href: "/journal/hello-world" });
	});

	// An unpopulated relationship is just an id, which cannot be routed.
	it("returns null and reports a bare-id reference", () => {
		const { seen, onDiagnostic } = collectDiagnostics();

		expect(
			resolveLink({
				link: {
					type: "reference",
					reference: { relationTo: "articles", value: "a1" },
				},
				mappings,
				locale: "en",
				onDiagnostic,
			}),
		).toBeNull();
		expect(seen).toEqual([
			{ reason: "unpopulated-reference", collection: "articles" },
		]);
	});

	it("returns null when the referenced collection has no mapping", () => {
		expect(
			resolveLink({
				link: {
					type: "reference",
					reference: {
						relationTo: "notes",
						value: { id: "n1", slug: "hello-world" },
					},
				},
				mappings,
				locale: "en",
			}),
		).toBeNull();
	});

	/*
	 * Without this a link authored inside a preview would navigate out of the
	 * preview, which is the whole point of the prefix.
	 */
	it("applies `formatHref` to reference links", () => {
		expect(
			resolveLink({
				link: {
					type: "reference",
					reference: {
						relationTo: "articles",
						value: { id: "a1", slug: "hello-world" },
					},
					newTab: true,
				},
				mappings,
				locale: "en",
				formatHref: ({ path }) => `/-preview${path}`,
			}),
		).toEqual({
			href: "/-preview/journal/hello-world",
			target: "_blank",
			rel: "noopener noreferrer",
		});
	});

	it("uses `resolveReference` instead of the populated document when supplied", () => {
		expect(
			resolveLink({
				link: {
					type: "reference",
					reference: {
						relationTo: "articles",
						value: { id: "a1", slug: "hello-world" },
					},
				},
				mappings,
				locale: "en",
				resolveReference: ({ relationTo, locale }) =>
					`/${locale}/${relationTo}/from-index`,
			}),
		).toEqual({ href: "/en/articles/from-index" });
	});

	it("returns null when `resolveReference` finds nothing", () => {
		expect(
			resolveLink({
				link: {
					type: "reference",
					reference: { relationTo: "articles", value: "a1" },
				},
				mappings,
				locale: "en",
				resolveReference: () => null,
			}),
		).toBeNull();
	});
});

describe("resolveLink variants", () => {
	/** The fields the variant contributes, plus what its resolver adds back. */
	interface DownloadExtra {
		fileName?: string | null;
		download?: boolean;
	}

	const variants: LinkVariant<{ base: string }, DownloadExtra>[] = [
		{
			value: "download",
			label: "Download",
			resolve: ({ link, context }) => ({
				href: `${context.base}/${link.fileName ?? ""}`,
				download: true,
			}),
		},
	];

	it("calls the variant's own resolver and keeps its extra properties", () => {
		expect(
			resolveLink({
				link: { type: "download", fileName: "hello-world.pdf" },
				mappings,
				locale: "en",
				variants,
				context: { base: "/files" },
			}),
		).toEqual({ href: "/files/hello-world.pdf", download: true });
	});

	it("returns null for a variant that declares no resolver", () => {
		expect(
			resolveLink({
				link: { type: "download" },
				mappings,
				locale: "en",
				variants: [{ value: "download", label: "Download" }],
			}),
		).toBeNull();
	});

	it("returns null for a type no variant declares", () => {
		expect(
			resolveLink({ link: { type: "download" }, mappings, locale: "en" }),
		).toBeNull();
	});
});

describe("isAvailableLink", () => {
	it("is true when the link resolves", () => {
		expect(
			isAvailableLink({
				link: { type: "custom", url: "https://example.com" },
				mappings,
				locale: "en",
			}),
		).toBe(true);
	});

	it("is false when the link resolves to nothing", () => {
		expect(
			isAvailableLink({ link: { type: "none" }, mappings, locale: "en" }),
		).toBe(false);
	});

	it("is false when a label is required and missing", () => {
		expect(
			isAvailableLink({
				link: { type: "custom", url: "https://example.com" },
				mappings,
				locale: "en",
				withLabel: true,
			}),
		).toBe(false);
	});

	it("is true when a label is required and present", () => {
		expect(
			isAvailableLink({
				link: { type: "custom", url: "https://example.com", label: "Read on" },
				mappings,
				locale: "en",
				withLabel: true,
			}),
		).toBe(true);
	});

	it("is false when a label is present but the link does not resolve", () => {
		expect(
			isAvailableLink({
				link: { type: "custom", label: "Read on" },
				mappings,
				locale: "en",
				withLabel: true,
			}),
		).toBe(false);
	});
});

interface ScrollBehaviour {
	onClick: () => void;
}

/**
 * Narrows a resolved link to its click handler, if it has one.
 *
 * The return type is a union because the built-in branches genuinely do not
 * produce the variant's extra, so reading it needs a narrowing rather than a
 * cast. Kept out of the test bodies, which may not branch.
 */
const clickHandlerOf = (
	resolved: BaseResolvedLink | ResolvedLink<ScrollBehaviour> | null,
): (() => void) | undefined =>
	resolved && "onClick" in resolved ? resolved.onClick : undefined;

describe("resolveLink with a variant overriding a built-in", () => {
	/*
	 * An in-page link on a site with a fixed header cannot be a plain anchor:
	 * the browser scrolls the target under the header. That is still
	 * `same-page` to an editor, so the app replaces how the built-in resolves
	 * rather than inventing a second link type and migrating content onto it.
	 */
	const scrolled: string[] = [];

	const samePageWithOffset: LinkVariant<{ offset: number }, ScrollBehaviour> = {
		value: "same-page",
		label: "Same page",
		resolve: ({ link, context }) => {
			const id = link.samePageIdentifier;

			if (!id) {
				return null;
			}

			return {
				href: `#${id}`,
				onClick: () => scrolled.push(`${id}@${String(context.offset)}`),
			};
		},
	};

	it("resolves through the variant rather than the built-in", () => {
		const resolved = resolveLink<{ offset: number }, ScrollBehaviour>({
			link: { type: "same-page", samePageIdentifier: "pricing" },
			mappings: [],
			locale: "en",
			variants: [samePageWithOffset],
			context: { offset: 80 },
		});

		expect(resolved?.href).toBe("#pricing");
		expect(clickHandlerOf(resolved)).toBeTypeOf("function");

		clickHandlerOf(resolved)?.();

		expect(scrolled).toEqual(["pricing@80"]);
	});

	it("still falls back to the built-in when no variant claims the value", () => {
		const resolved = resolveLink({
			link: { type: "same-page", samePageIdentifier: "pricing" },
			mappings: [],
			locale: "en",
		});

		expect(resolved).toEqual({ href: "#pricing" });
		expect(clickHandlerOf(resolved)).toBeUndefined();
	});
});

describe("resolveLink with several variants", () => {
	/*
	 * Each variant contributes its own fields, and the type parameter is the
	 * union of all of them. Requiring the whole union would mean every variant
	 * had to return the others' properties alongside its own, which no variant
	 * can do — so both what a variant reads and what it returns are optional.
	 */
	interface ActionExtra {
		action?: string | null;
	}

	interface DownloadExtra {
		fileName?: string | null;
		download?: boolean;
	}

	type Extras = ActionExtra & DownloadExtra;

	const variants: LinkVariant<{ base: string }, Extras>[] = [
		{
			value: "action",
			label: "Action",
			fields: [{ name: "action", type: "text" }],
			resolve: ({ link }) => ({ href: "", action: link.action }),
		},
		{
			value: "download",
			label: "Download",
			fields: [{ name: "fileName", type: "text" }],
			resolve: ({ link, context }) => ({
				href: `${context.base}/${link.fileName ?? ""}`,
				download: true,
			}),
		},
	];

	it("routes each type to its own resolver", () => {
		expect(
			resolveLink({
				link: { type: "action", action: "renew-consent" },
				mappings: [],
				locale: "en",
				variants,
				context: { base: "/files" },
			}),
		).toEqual({ href: "", action: "renew-consent" });

		expect(
			resolveLink({
				link: { type: "download", fileName: "report.pdf" },
				mappings: [],
				locale: "en",
				variants,
				context: { base: "/files" },
			}),
		).toEqual({ href: "/files/report.pdf", download: true });
	});

	it("gives every variant its own conditional fields", () => {
		const group = linkField({ relationTo: ["pages"], variants });
		const names = (group as { fields: { name?: string }[] }).fields.map(
			(it) => it.name,
		);

		expect(names).toContain("action");
		expect(names).toContain("fileName");
	});
});

describe("resolveLink with a declaration", () => {
	const links = defineLinks<{ filesBase: string }>()((variant) => ({
		variants: {
			download: variant({
				label: "Download",
				fields: [{ name: "fileName", type: "text" }],
			}).resolve(({ link, context }) => ({
				href: `${context.filesBase}/${link.fileName ?? ""}`,
				download: true,
			})),
		},
	}));

	it("resolves through the declaration exactly as through the array", () => {
		expect(
			resolveLink({
				link: { type: "download", fileName: "report.pdf" },
				mappings: [],
				locale: "en",
				links,
				context: { filesBase: "/files" },
			}),
		).toEqual({ href: "/files/report.pdf", download: true });
	});

	it("reports a type that is neither built in nor declared", () => {
		/*
		 * The failure this diagnostic exists for: a variant added to the field
		 * but not passed to the resolver. Without it the link simply vanishes.
		 */
		const seen: Diagnostic<ResolveLinkDiagnosticReason>[] = [];

		expect(
			resolveLink({
				link: { type: "download", fileName: "report.pdf" },
				mappings: [],
				locale: "en",
				onDiagnostic: (it) => seen.push(it),
			}),
		).toBeNull();

		expect(seen).toEqual([{ reason: "unknown-variant", variant: "download" }]);
	});

	it("stays quiet for a built-in that simply has no value", () => {
		const seen: Diagnostic<ResolveLinkDiagnosticReason>[] = [];

		resolveLink({
			link: { type: "custom" },
			mappings: [],
			locale: "en",
			onDiagnostic: (it) => seen.push(it),
		});

		expect(seen).toEqual([]);
	});
});
