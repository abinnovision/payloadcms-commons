import type { CollectionConfig } from "payload";

export const posts: CollectionConfig = {
	slug: "posts",
	trash: true,
	admin: { useAsTitle: "title" },
	versions: { drafts: true },
	fields: [
		{ name: "title", type: "text", required: true, localized: true },
		{ name: "excerpt", type: "text", localized: true },
		{ name: "content", type: "richText", localized: true },
		{ name: "image", type: "upload", relationTo: "media" },
		{ name: "tags", type: "relationship", relationTo: "tags", hasMany: true },
	],
};
