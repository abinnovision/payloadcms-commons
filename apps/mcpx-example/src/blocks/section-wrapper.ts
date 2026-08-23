import { heroBlock } from "./hero";

import type { Block } from "payload";

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
			blocks: [],
			blockReferences: [heroBlock, "richText"],
		},
	],
};
