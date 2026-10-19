import type { Block } from "payload";

/**
 * Inline block: kept out of `config.blocks` on purpose, so it never reaches
 * `montagePlugin`. See `packages/montage/docs/recipes.md`.
 */
export const sectionWrapperBlock: Block = {
	slug: "section-wrapper",
	fields: [
		{ name: "identifier", type: "text" },
		{
			name: "modules",
			type: "blocks",
			blocks: [],
			blockReferences: [
				"hero-module",
				"rich-text-module",
				"recent-posts-module",
				"call-to-action-module",
			],
		},
	],
};
