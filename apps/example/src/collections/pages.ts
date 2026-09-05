import { sectionWrapperBlock } from "../blocks/section-wrapper";

import type { CollectionConfig } from "payload";

/**
 * Pages hold a full path in `slug`, leading slash included, so a page can live
 * at any depth without a pattern per level. The mapping row for this
 * collection is the wildcard `/*slug`, and the site root is the page whose
 * slug is exactly `/`.
 */
export const pages: CollectionConfig = {
	slug: "pages",
	admin: {
		useAsTitle: "title",
		defaultColumns: ["title", "slug"],
		/*
		 * Server-side live preview: the iframe loads the real route, which
		 * re-renders on the server when the document is saved. Client-side live
		 * preview would hand the page a freshly deserialised document, and
		 * montage keys resolver results by object identity, so nothing resolved
		 * would survive.
		 *
		 * The URL names no path shape either. `/preview` resolves the document's
		 * own href through the mapping, so preview follows whatever pattern the
		 * editor authored rather than a second copy of it written here.
		 */
		livePreview: {
			url: ({ data, locale }) =>
				`/preview?collection=pages&id=${String(data["id"] ?? "")}&locale=${locale.code}`,
		},
	},
	versions: { drafts: true },
	// Linkable, so a reference resolves without the query having to reach it.
	defaultPopulate: { slug: true, title: true },
	fields: [
		{ name: "title", type: "text", required: true, localized: true },
		{
			name: "slug",
			type: "text",
			required: true,
			unique: true,
			admin: {
				description:
					'Full path with a leading slash, e.g. "/about/team". Use "/" for the home page.',
			},
		},
		{
			name: "layout",
			type: "blocks",
			required: true,
			blocks: [],
			// The section wrapper is passed by reference here rather than
			// registered in config.blocks, since it is instantiated per host
			// (see packages/montage/docs/recipes.md).
			blockReferences: [sectionWrapperBlock, "rich-text-module"],
		},
		{
			name: "meta",
			type: "group",
			fields: [{ name: "title", type: "text", localized: true }],
		},
	],
};
