import { sectionWrapperBlock } from "../blocks/section-wrapper";

import type { CollectionConfig } from "payload";

export const pages: CollectionConfig = {
	slug: "pages",
	admin: { useAsTitle: "title" },
	versions: { drafts: true },
	fields: [
		{ name: "title", type: "text", required: true },
		{ name: "slug", type: "text", required: true },
		{
			name: "layout",
			type: "blocks",
			required: true,
			blocks: [],
			// The section wrapper is passed by reference here rather than
			// registered in config.blocks, since it is instantiated per host
			// (see packages/montage/docs/recipes.md).
			blockReferences: [sectionWrapperBlock],
		},
	],
};
