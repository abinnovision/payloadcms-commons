import { richTextBlock } from "../blocks/rich-text";
import { sectionWrapperBlock } from "../blocks/section-wrapper";

import type { CollectionConfig } from "payload";

export const pages: CollectionConfig = {
	slug: "pages",
	admin: { useAsTitle: "title" },
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
