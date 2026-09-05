import { sectionWrapperBlock } from "../blocks/section-wrapper";

import type { CollectionConfig } from "payload";

/**
 * Articles sit under their section, so their pattern takes two parameters. The
 * last one identifies the article; the first narrows the lookup.
 *
 * They carry the same `layout` field as pages, which is what lets the one
 * catch-all route render either without branching on the collection it got.
 */
export const articles: CollectionConfig = {
	slug: "articles",
	admin: {
		useAsTitle: "title",
		defaultColumns: ["title", "section", "slug"],
		livePreview: {
			url: ({ data, locale }) =>
				`/preview?collection=articles&id=${String(data["id"] ?? "")}&locale=${locale.code}`,
		},
	},
	versions: { drafts: true },
	defaultPopulate: { slug: true, title: true, section: true },
	fields: [
		{ name: "title", type: "text", required: true, localized: true },
		{ name: "slug", type: "text", required: true },
		{
			name: "section",
			type: "relationship",
			relationTo: "sections",
			required: true,
		},
		{
			name: "layout",
			type: "blocks",
			required: true,
			blocks: [],
			blockReferences: [sectionWrapperBlock, "rich-text-module"],
		},
	],
};
