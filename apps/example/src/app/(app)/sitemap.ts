import { createRouter } from "@abinnovision/payloadcms-wayfinder";
import config from "@payload-config";
import { getPayload } from "payload";

import { LOCALES } from "../../locales";
import { routerArgs } from "../../wayfinder";

import type { MetadataRoute } from "next";

const serverURL = process.env["PAYLOAD_URL"] ?? "http://localhost:3000";

/*
 * The URLs here come from content and from the mapping an editor authored, so
 * baking them at build time would freeze both. Rendered per request instead,
 * which also means the build needs no database.
 */
export const dynamic = "force-dynamic";

/**
 * Which fields each routed collection's pattern needs, in pattern order.
 *
 * A sitemap runs outside a request and selects only what it needs, so it never
 * holds a document shaped the way `href` expects. It does hold the values,
 * which is all a pattern needs — and passing them positionally means renaming
 * a parameter in the admin panel does not break this file.
 */
const ROUTED = {
	pages: {
		select: { slug: true, updatedAt: true },
		drafts: true,
		values: (it: Doc) => [str(it["slug"])],
	},
	sections: {
		select: { slug: true, updatedAt: true },
		// No `versions`, so there is no `_status` column to filter on.
		drafts: false,
		values: (it: Doc) => [str(it["slug"])],
	},
	articles: {
		select: { slug: true, section: true, updatedAt: true },
		drafts: true,
		values: (it: Doc) => [sectionSlug(it["section"]), str(it["slug"])],
	},
} as const;

type Doc = Record<string, unknown>;

const str = (value: unknown): string =>
	typeof value === "string" ? value : "";

/** `depth: 1` populates the relationship, so its identifier is readable. */
const sectionSlug = (value: unknown): string =>
	value && typeof value === "object" ? str((value as Doc)["slug"]) : "";

const sitemap = async (): Promise<MetadataRoute.Sitemap> => {
	const payload = await getPayload({ config });
	const entries: MetadataRoute.Sitemap = [];

	for (const locale of LOCALES) {
		const router = createRouter(await routerArgs(locale));

		for (const [collection, spec] of Object.entries(ROUTED)) {
			const result = await payload.find({
				collection: collection as keyof typeof ROUTED,
				locale,
				depth: 1,
				limit: 0,
				select: spec.select,
				/*
				 * Only on the collections that keep versions. A collection
				 * without them has no `_status` column, and the query fails
				 * outright rather than coming back empty — the same asymmetry
				 * the catch-all route leaves to the package.
				 */
				...(spec.drafts ? { where: { _status: { equals: "published" } } } : {}),
			});

			for (const doc of result.docs) {
				entries.push({
					url: new URL(
						router.path(collection, spec.values(doc)),
						serverURL,
					).toString(),
					lastModified: str((doc as Doc)["updatedAt"]) || undefined,
				});
			}
		}
	}

	return entries;
};

export default sitemap;
