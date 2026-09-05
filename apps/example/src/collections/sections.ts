import type { CollectionConfig } from "payload";

/**
 * Sections group articles and have pages of their own, which is what makes
 * `/:section/:slug` work: the `section` parameter is a relationship, so the
 * lookup matches on the related document's own identifier.
 */
export const sections: CollectionConfig = {
	slug: "sections",
	admin: { useAsTitle: "title", defaultColumns: ["title", "slug"] },
	defaultPopulate: { slug: true, title: true },
	fields: [
		{ name: "title", type: "text", required: true },
		{ name: "slug", type: "text", required: true, unique: true },
	],
};
