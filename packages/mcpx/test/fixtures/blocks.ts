import { payloadMajor } from "@internal/test-utils/payload-major";
import {
	BlocksFeature,
	lexicalEditor,
	ParagraphFeature,
} from "@payloadcms/richtext-lexical";

import type { Block, BlocksField } from "payload";

/**
 * Blocks declaration in the shape of the installed Payload major: Payload 3
 * keeps references in `blockReferences`, Payload 4 in `blocks`.
 */
export const blocksField = (
	blocks: (Block | string)[],
): Pick<BlocksField, "blocks"> => {
	const shape: unknown =
		payloadMajor() === 3 ? { blocks: [], blockReferences: blocks } : { blocks };

	return shape as Pick<BlocksField, "blocks">;
};

/**
 * Inline block whose title editor only knows paragraphs, so the Lexical node
 * gate has something to refuse.
 */
const heroBlock: Block = {
	slug: "hero",
	fields: [
		{
			name: "title",
			type: "richText",
			required: true,
			editor: lexicalEditor({ features: [ParagraphFeature()] }),
		},
		{ name: "body", type: "richText" },
		{
			name: "imageSize",
			type: "select",
			options: ["small", "large"],
			defaultValue: "small",
		},
	],
};

/**
 * Registered on `config.blocks` and referenced by slug, so the registry path
 * of block resolution is covered.
 */
export const richTextBlock: Block = {
	slug: "richText",
	fields: [{ name: "content", type: "richText", required: true }],
};

/**
 * Inline block nesting other blocks: one inline, one by reference.
 */
export const sectionWrapperBlock: Block = {
	slug: "sectionWrapper",
	fields: [
		{ name: "identifier", type: "text" },
		{
			name: "modules",
			type: "blocks",
			...blocksField([heroBlock, "richText"]),
		},
	],
};

/**
 * Inline block used inside an array field, so pointer resolution through
 * `array -> blocks` is covered.
 */
export const ctaBlock: Block = {
	slug: "cta",
	fields: [{ name: "label", type: "text", required: true }],
};

/**
 * Lexical block, registered on `config.blocks` and reached only through a rich
 * text node. Its own editor accepts the block again, so the cycle guard of
 * `reachableSchemaPaths` has something to stop.
 */
export const calloutBlock: Block = {
	slug: "callout",
	fields: [
		{ name: "tone", type: "select", options: ["info", "warning"] },
		{
			name: "note",
			type: "richText",
			editor: lexicalEditor({
				features: [BlocksFeature({ blocks: ["callout"] })],
			}),
		},
	],
};

/**
 * Lexical inline block, so the node type taking a slug is covered twice.
 */
export const badgeBlock: Block = {
	slug: "badge",
	fields: [{ name: "label", type: "text", required: true }],
};
