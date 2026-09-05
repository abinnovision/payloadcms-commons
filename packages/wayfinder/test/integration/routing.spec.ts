import { beforeAll, describe, expect, it } from "vitest";

import {
	bootPayload,
	PRIMARY_LOCALE,
	UNSAVED_MAPPING_GLOBAL_SLUG,
} from "./helpers/payload.js";
import {
	DEFAULT_MAPPING_GLOBAL_SLUG,
	loadMappings,
} from "../../src/config/index.js";
import { defineMappings } from "../../src/pattern/index.js";
import { createRouter } from "../../src/runtime/create-router.js";
import {
	buildHref,
	resolvePathToDocument,
	resolveRelationshipSlug,
} from "../../src/runtime/index.js";

import type { Diagnostic, DiagnosticReason } from "../../src/index.js";
import type { PayloadCollectionMappingResolved } from "../../src/pattern/index.js";
import type { Payload } from "payload";

const PREVIEW_PREFIX = "/preview";

describe("wayfinder against a real, localized Payload instance (sqlite)", () => {
	let payload: Payload;
	let mappings: PayloadCollectionMappingResolved[];
	/*
	 * Left as the adapter returns them. These were stringified here once,
	 * which meant every assertion compared strings and the numeric ids sqlite
	 * actually produces were never exercised — the shape half the callers see
	 * in production.
	 */
	let sectionId: string | number;
	let articleId: string | number;
	let nestedPageId: string | number;
	let collidingPageId: string | number;
	let draftPageId: string | number;

	beforeAll(async () => {
		payload = await bootPayload({ key: "wayfinder-routing", localized: true });

		const section = await payload.create({
			collection: "sections",
			data: { title: "Insights", slug: "insights", handle: "insights-hub" },
		});
		sectionId = section.id;

		const article = await payload.create({
			collection: "articles",
			data: { title: "First Look", slug: "first-look", section: section.id },
		});
		articleId = article.id;

		const nestedPage = await payload.create({
			collection: "pages",
			data: { title: "Team", slug: "/about/team", _status: "published" },
		});
		nestedPageId = nestedPage.id;

		/*
		 * Sits under an existing section slug, so its path is claimed by the
		 * article pattern before the wildcard ever gets a look at it.
		 */
		const collidingPage = await payload.create({
			collection: "pages",
			data: {
				title: "Not An Article",
				slug: "/insights/not-an-article",
				_status: "published",
			},
		});
		collidingPageId = collidingPage.id;

		const draftPage = await payload.create({
			collection: "pages",
			draft: true,
			data: { title: "Hidden", slug: "/drafts/hidden", _status: "draft" },
		});
		draftPageId = draftPage.id;

		await payload.create({
			collection: "notes",
			data: { title: "Release Notes", slug: "release-1" },
		});

		/*
		 * Authored in one locale only. The read side asks for `locale: "all"`,
		 * so what comes back is a per-locale record with just this key — which
		 * is the shape no-locale.spec.ts exists to contrast against.
		 */
		await payload.updateGlobal({
			slug: DEFAULT_MAPPING_GLOBAL_SLUG,
			locale: PRIMARY_LOCALE,
			data: {
				collections: [
					{ collectionName: "pages", path: "/*slug" },
					{ collectionName: "articles", path: "/:section/:slug" },
					{ collectionName: "sections", path: "/topic/:slug" },
					{ collectionName: "notes", path: "/notes/:slug" },
				],
			},
		});

		mappings = await loadMappings({ payload, localized: true });
	});

	describe("loadMappings", () => {
		it("compiles what the global holds, keyed by locale", () => {
			expect(mappings.map((it) => it.collection).sort()).toEqual([
				"articles",
				"notes",
				"pages",
				"sections",
			]);

			const pages = mappings.find((it) => it.collection === "pages");
			expect(pages?.path).toEqual({ [PRIMARY_LOCALE]: "/*slug" });
			expect(pages?.resolvers[PRIMARY_LOCALE]?.paramNames).toEqual(["slug"]);
		});

		it("returns an empty list for a global that was never saved", async () => {
			/*
			 * Every project's first boot. Routing degrades to "nothing matches"
			 * rather than crashing on the way to the admin panel.
			 */
			await expect(
				loadMappings({
					payload,
					globalSlug: UNSAVED_MAPPING_GLOBAL_SLUG,
					localized: true,
				}),
			).resolves.toEqual([]);
		});
	});

	describe("resolvePathToDocument", () => {
		it("finds a page at a nested path", async () => {
			const resolved = await resolvePathToDocument({
				payload,
				mappings,
				path: "/about/team",
				locale: PRIMARY_LOCALE,
			});

			expect(resolved?.collection).toBe("pages");
			expect(resolved?.document.id).toBe(nestedPageId);
		});

		it("finds an article at its section-scoped path", async () => {
			const resolved = await resolvePathToDocument({
				payload,
				mappings,
				path: "/insights/first-look",
				locale: PRIMARY_LOCALE,
			});

			expect(resolved?.collection).toBe("articles");
			expect(resolved?.document.id).toBe(articleId);
			/*
			 * The scope parameter survives onto the match, which is what a
			 * caller needs to render breadcrumbs without a second lookup.
			 */
			expect(resolved?.match.scope).toEqual({ section: "insights" });
		});

		it("falls through to the page wildcard when the more specific pattern finds nothing", async () => {
			/*
			 * "/insights/not-an-article" fits both "/:section/:slug" and
			 * "/*slug". The article pattern is tried first because it is more
			 * specific; without the fall-through this path would 404 despite
			 * the page existing.
			 */
			const resolved = await resolvePathToDocument({
				payload,
				mappings,
				path: "/insights/not-an-article",
				locale: PRIMARY_LOCALE,
			});

			expect(resolved?.collection).toBe("pages");
			expect(resolved?.document.id).toBe(collidingPageId);
		});

		it("honours a `where` override that filters the document out", async () => {
			const resolved = await resolvePathToDocument({
				payload,
				mappings,
				path: "/insights/first-look",
				locale: PRIMARY_LOCALE,
				where: { title: { equals: "Nothing By This Name" } },
			});

			/*
			 * No page holds this path either, so the fall-through has nowhere
			 * left to go and the whole resolution is null.
			 */
			expect(resolved).toBeNull();
		});
	});

	describe("buildHref", () => {
		it("reproduces the path a page was found at", async () => {
			const page = await payload.findByID({
				collection: "pages",
				id: nestedPageId,
				locale: PRIMARY_LOCALE,
			});

			expect(
				buildHref({
					mappings,
					collection: "pages",
					document: page,
					locale: PRIMARY_LOCALE,
				}),
			).toBe("/about/team");
		});

		it("reproduces the path an article was found at, reading its populated section", async () => {
			const article = await payload.findByID({
				collection: "articles",
				id: articleId,
				locale: PRIMARY_LOCALE,
				depth: 1,
			});

			expect(
				buildHref({
					mappings,
					collection: "articles",
					document: article,
					locale: PRIMARY_LOCALE,
				}),
			).toBe("/insights/first-look");
		});
	});

	describe("preview", () => {
		/*
		 * `payload.find` with `draft: false` reads the collection table, whose
		 * row for a never-published document still carries
		 * `_status: "draft"` — so without a published-only condition a URL
		 * becomes public the moment someone saves a draft at it. The package
		 * adds that condition itself, conditionally, because the column only
		 * exists on collections that keep drafts.
		 */
		it("hides a draft-only document from a published read", async () => {
			const published = await resolvePathToDocument({
				payload,
				mappings,
				path: "/drafts/hidden",
				locale: PRIMARY_LOCALE,
			});

			expect(published).toBeNull();
		});

		it("returns a draft-only document for a draft read", async () => {
			const drafted = await resolvePathToDocument({
				payload,
				mappings,
				path: "/drafts/hidden",
				locale: PRIMARY_LOCALE,
				draft: true,
			});

			expect(drafted?.document.id).toBe(draftPageId);
		});

		it("does not fail a draft read against a collection that keeps no versions", async () => {
			/*
			 * Payload only adds `_status` to a versioned collection, so a
			 * draft query against `notes` would error rather than come back
			 * empty. The guard makes preview safe to switch on globally.
			 */
			const resolved = await resolvePathToDocument({
				payload,
				mappings,
				path: "/notes/release-1",
				locale: PRIMARY_LOCALE,
				draft: true,
			});

			expect(resolved?.collection).toBe("notes");
		});

		it("round-trips a prefixed preview href back to the same document", async () => {
			const page = await payload.findByID({
				collection: "pages",
				id: nestedPageId,
				locale: PRIMARY_LOCALE,
			});

			const href = buildHref({
				mappings,
				collection: "pages",
				document: page,
				locale: PRIMARY_LOCALE,
				formatHref: ({ path }) => `${PREVIEW_PREFIX}${path}`,
			});

			expect(href).toBe("/preview/about/team");

			/*
			 * The prefix is a routing concern of the consumer, so stripping it
			 * has to hand back a path the package can still resolve.
			 */
			const resolved = await resolvePathToDocument({
				payload,
				mappings,
				path: href!.slice(PREVIEW_PREFIX.length),
				locale: PRIMARY_LOCALE,
				draft: true,
			});

			expect(resolved?.document.id).toBe(nestedPageId);
		});
	});

	describe("resolveRelationshipSlug", () => {
		it("recovers a scope value from a bare relationship id", async () => {
			/*
			 * The admin preview case: form state holds the id an editor picked,
			 * never a populated document, so a preview URL built without this
			 * would carry the id and never match back.
			 */
			const value = await resolveRelationshipSlug({
				payload,
				config: payload.collections["articles"]!.config,
				param: "section",
				value: sectionId,
			});

			expect(value).toBe("insights");
		});
	});

	describe("resolving a reference against real documents", () => {
		/*
		 * The link path had no integration coverage at all, which is how it
		 * came to assume a reference id is a string. Sqlite numbers them, so
		 * everything here is exercised against the ids the adapter actually
		 * produced rather than against hand-written ones.
		 */
		it("routes a populated reference through its collection mapping", async () => {
			const article = await payload.findByID({
				collection: "articles",
				id: articleId,
				depth: 1,
				locale: PRIMARY_LOCALE,
			});

			const resolved = createRouter({
				mappings,
				locale: PRIMARY_LOCALE,
			}).link({
				type: "reference",
				reference: { relationTo: "articles", value: article },
			});

			expect(resolved?.href).toBe("/insights/first-look");
		});

		/*
		 * The id an unpopulated relationship leaves behind is a number here,
		 * and reporting it as unpopulated is the whole point: checking only
		 * for a string sent it on to the href builder, which then blamed a
		 * missing path parameter for a reference nobody had populated.
		 */
		it("reports a bare numeric id as an unpopulated reference", () => {
			const seen: Diagnostic<DiagnosticReason>[] = [];

			const resolved = createRouter({
				mappings,
				locale: PRIMARY_LOCALE,
				onDiagnostic: (it) => seen.push(it),
			}).link({
				type: "reference",
				reference: { relationTo: "articles", value: articleId },
			});

			expect(resolved).toBeNull();
			expect(seen).toEqual([
				{ reason: "unpopulated-reference", collection: "articles" },
			]);
		});
	});

	describe("derived identifier field", () => {
		/*
		 * A relationship parameter is matched against whatever the target's own
		 * pattern ends in, not against `slug` by assumption. Pointing `sections`
		 * at `/topic/:handle` has to move the article lookup onto
		 * `section.handle` without any other change.
		 */
		const derived = defineMappings([
			{ collection: "pages", path: { [PRIMARY_LOCALE]: "/*slug" } },
			{ collection: "articles", path: { [PRIMARY_LOCALE]: "/:section/:slug" } },
			{ collection: "sections", path: { [PRIMARY_LOCALE]: "/topic/:handle" } },
		]);

		it("queries the field the target's pattern names", async () => {
			const resolved = await resolvePathToDocument({
				payload,
				mappings: derived,
				path: "/insights-hub/first-look",
				locale: PRIMARY_LOCALE,
			});

			expect(resolved?.collection).toBe("articles");
			expect(resolved?.document.id).toBe(articleId);
		});

		it("does not find the same path under the slug-keyed mapping", async () => {
			/*
			 * Same path, mappings that say sections are identified by `slug`:
			 * "insights-hub" is no section's slug, so nothing matches.
			 */
			await expect(
				resolvePathToDocument({
					payload,
					mappings,
					path: "/insights-hub/first-look",
					locale: PRIMARY_LOCALE,
				}),
			).resolves.toBeNull();
		});

		it("reads the derived identifier back off a bare relationship id", async () => {
			const value = await resolveRelationshipSlug({
				payload,
				config: payload.collections["articles"]!.config,
				param: "section",
				value: sectionId,
				mappings: derived,
				locale: PRIMARY_LOCALE,
			});

			expect(value).toBe("insights-hub");
		});
	});
});
