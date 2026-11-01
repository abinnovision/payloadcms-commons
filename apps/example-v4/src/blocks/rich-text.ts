import {
	linkLabelFeature,
	wayfinderLinkFeature,
} from "@abinnovision/payloadcms-wayfinder/lexical";
import { BlocksFeature, lexicalEditor } from "@payloadcms/richtext-lexical";

import { calloutBlock } from "./callout";
import { linkTargets } from "../links";

import type { Block } from "payload";

/**
 * Registered through `montagePlugin` and referenced from other blocks by slug
 * rather than by object, which is the case `describeSchema` has to follow
 * through `config.blocks` to resolve.
 *
 * Its editor embeds `callout`, so the block tree continues inside the rich
 * text: montage's `./lexical` converters dispatch that node back into the same
 * registry (see `RichTextModule`). Its links go through wayfinder's Lexical
 * feature, so a link typed into a paragraph routes through the same mapping as
 * one authored in a `call-to-action-module`.
 */
export const richTextBlock: Block = {
	slug: "rich-text-module",
	interfaceName: "RichTextModuleBlock",
	fields: [
		{
			name: "content",
			type: "richText",
			localized: true,
			editor: lexicalEditor({
				features: ({ defaultFeatures }) => [
					...defaultFeatures.filter((feature) => feature.key !== "link"),
					BlocksFeature({ blocks: [calloutBlock] }),
					wayfinderLinkFeature(linkTargets),
					linkLabelFeature(),
				],
			}),
		},
	],
};
