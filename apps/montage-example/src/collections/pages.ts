import { sectionWrapperBlock } from "../blocks/section-wrapper";

import type { CollectionConfig } from "payload";

export const pages: CollectionConfig = {
	slug: "pages",
	admin: {
		useAsTitle: "title",
		/*
		 * Server-side live preview: the iframe loads the real route, which
		 * re-renders on the server when the document is saved. Client-side live
		 * preview would hand the page a freshly deserialised document, and
		 * montage keys resolver results by object identity, so nothing resolved
		 * would survive the round trip.
		 */
		livePreview: {
			url: ({ data }) =>
				`/preview?path=${encodeURIComponent(`/${String(data["slug"] ?? "")}`)}`,
		},
	},
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
