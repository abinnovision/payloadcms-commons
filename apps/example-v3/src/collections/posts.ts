import {
	BlocksFeature,
	LinkFeature,
	lexicalEditor,
} from "@payloadcms/richtext-lexical";

import { calloutBlock } from "../blocks/callout";

import type { CollectionConfig } from "payload";

/**
 * Not routed: posts have no mapping row, so no URL resolves to one. They are
 * read by `recent-posts-module`'s resolver, and they are the entity mcpx is
 * configured `publish: false` for, where an MCP client writes and a human
 * publishes.
 */
export const posts: CollectionConfig = {
	slug: "posts",
	trash: true,
	admin: { useAsTitle: "title" },
	versions: { drafts: true },
	fields: [
		{ name: "title", type: "text", required: true, localized: true },
		{ name: "excerpt", type: "text", localized: true },
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
		{ name: "image", type: "upload", relationTo: "media" },
		{ name: "tags", type: "relationship", relationTo: "tags", hasMany: true },
	],
};
