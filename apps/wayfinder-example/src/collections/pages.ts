import type { CollectionConfig } from "payload";

/**
 * Pages hold a full path in `slug`, leading slash included, so a page can live
 * at any depth without a pattern per level. The mapping row for this
 * collection is the wildcard `/*slug`, and the site root is the page whose
 * slug is exactly `/`.
 */
export const pages: CollectionConfig = {
	slug: "pages",
	admin: { useAsTitle: "title", defaultColumns: ["title", "slug"] },
	versions: { drafts: true },
	// Linkable, so a reference resolves without the query having to reach it.
	defaultPopulate: { slug: true, title: true },
	fields: [
		{ name: "title", type: "text", required: true },
		{
			name: "slug",
			type: "text",
			required: true,
			unique: true,
			admin: {
				description:
					'Full path with a leading slash, e.g. "/about/team". Use "/" for the home page.',
			},
		},
		{ name: "body", type: "textarea" },
	],
};
