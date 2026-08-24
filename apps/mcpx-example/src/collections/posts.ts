import {
	BlocksFeature,
	LinkFeature,
	lexicalEditor,
} from "@payloadcms/richtext-lexical";

import { calloutBlock } from "../blocks/callout";

import type { CollectionConfig } from "payload";

export const posts: CollectionConfig = {
	slug: "posts",
	admin: { useAsTitle: "title" },
	versions: { drafts: true },
	fields: [
		{ name: "title", type: "text", required: true },
		{
			name: "content",
			type: "richText",
			localized: true,
			editor: lexicalEditor({
				features: ({ defaultFeatures }) => [
					...defaultFeatures.filter((feature) => feature.key !== "link"),
					BlocksFeature({ blocks: [calloutBlock] }),
					LinkFeature({
						fields: ({ defaultFields }) => [
							...defaultFields,
							{
								name: "rel",
								type: "select",
								options: ["nofollow", "sponsored"],
								admin: { description: "Value of the rendered rel attribute." },
							},
						],
					}),
				],
			}),
		},
		{
			name: "tags",
			type: "relationship",
			relationTo: "tags",
			hasMany: true,
		},
	],
};
