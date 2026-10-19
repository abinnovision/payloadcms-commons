import type { CollectionConfig } from "payload";

export const pages: CollectionConfig = {
	slug: "pages",
	trash: true,
	admin: { useAsTitle: "title", defaultColumns: ["title", "slug"] },
	versions: { drafts: true },
	fields: [
		{ name: "title", type: "text", required: true, localized: true },
		{ name: "slug", type: "text", required: true, unique: true },
		{ name: "content", type: "richText", localized: true },
	],
};
