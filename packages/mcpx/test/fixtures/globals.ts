import { richTextBlock, sectionWrapperBlock } from "./blocks.js";

import type { GlobalConfig } from "payload";

/**
 * Drafts-enabled global covering the interesting paths: a localized required
 * field, a non-localized required field that yields a deterministic publish
 * blocker, and a blocks field so pointer and patch resolution is exercised on a
 * global exactly as it is on `pages`.
 */
export const siteSettings: GlobalConfig = {
	slug: "site-settings",
	admin: {
		description: {
			en: "Settings shared by every page.",
			de: "Einstellungen für jede Seite.",
		},
	},
	versions: { drafts: true },
	fields: [
		{
			name: "title",
			type: "text",
			required: true,
			localized: true,
			admin: { description: { en: "Site title", de: "Seitentitel" } },
		},
		{ name: "tagline", type: "text", required: true },
		{
			name: "sections",
			type: "blocks",
			blocks: [],
			blockReferences: [sectionWrapperBlock, richTextBlock],
		},
	],
};

/**
 * Global without versions, so the `allowLiveWrites` branches and the
 * drafts-only half of `installGlobalDraftGuards` both have a subject.
 */
export const banner: GlobalConfig = {
	slug: "banner",
	fields: [{ name: "message", type: "text" }],
};
