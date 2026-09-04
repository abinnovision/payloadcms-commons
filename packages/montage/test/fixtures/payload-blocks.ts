import type { Block } from "payload";

/** Real Payload block config, registered through `montagePlugin`. */
export const heroModuleBlock: Block = {
	slug: "hero-module",
	interfaceName: "HeroModuleBlock",
	fields: [{ name: "title", type: "text", required: true }],
};

/** A relationship-bearing block: proves traversal reaches a populated relationship value. */
export const relatedPageModuleBlock: Block = {
	slug: "related-page-module",
	interfaceName: "RelatedPageModuleBlock",
	fields: [
		{
			name: "page",
			type: "relationship",
			relationTo: "pages",
			required: true,
		},
	],
};
