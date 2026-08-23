import type { CollectionConfig } from "payload";

export const posts: CollectionConfig = {
	slug: "posts",
	admin: { useAsTitle: "title" },
	versions: { drafts: true },
	fields: [
		{ name: "title", type: "text", required: true },
		{ name: "content", type: "richText", localized: true },
		{
			name: "tags",
			type: "relationship",
			relationTo: "tags",
			hasMany: true,
		},
	],
};
