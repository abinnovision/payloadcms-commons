import { lexicalEditor, ParagraphFeature } from "@payloadcms/richtext-lexical";

import type { Block } from "payload";

/**
 * Inline block. The title editor only knows paragraphs, so describeSchema
 * reports a smaller node set for it than for the body.
 */
export const heroBlock: Block = {
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
