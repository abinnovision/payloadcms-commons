import { richTextBlock, sectionWrapperBlock } from "./blocks.js";

import type { CollectionConfig } from "payload";

export const users: CollectionConfig = {
	slug: "users",
	auth: true,
	fields: [],
};

export const pages: CollectionConfig = {
	slug: "pages",
	versions: { drafts: true },
	fields: [
		{
			type: "tabs",
			tabs: [
				{
					label: "General",
					fields: [
						{ name: "title", type: "text", required: true, localized: true },
						{ name: "slug", type: "text", required: true },
					],
				},
				{
					name: "layout",
					fields: [
						{
							name: "color",
							type: "select",
							options: ["light", "dark"],
						},
						{
							name: "sections",
							type: "blocks",
							required: true,
							blocks: [],
							blockReferences: [sectionWrapperBlock, richTextBlock],
						},
					],
				},
			],
		},
		{
			name: "meta",
			type: "group",
			fields: [{ name: "title", type: "text" }],
		},
	],
};

export const posts: CollectionConfig = {
	slug: "posts",
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

export const tags: CollectionConfig = {
	slug: "tags",
	fields: [{ name: "name", type: "text", required: true }],
};
