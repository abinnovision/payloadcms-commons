import type { Block } from "payload";

/**
 * Registered on `config.blocks` and referenced by slug from other blocks.
 */
export const richTextBlock: Block = {
	slug: "richText",
	fields: [{ name: "content", type: "richText", required: true }],
};
