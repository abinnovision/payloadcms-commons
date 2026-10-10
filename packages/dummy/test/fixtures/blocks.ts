import type { Block } from "payload";

/** Carries a relationship, so a ref can sit two levels inside a blocks field. */
export const cardBlock: Block = {
	slug: "card",
	fields: [
		{ name: "heading", type: "text", required: true },
		{ name: "link", type: "relationship", relationTo: "pages" },
	],
};

/** Scalars only, so a block without any ref is present too. */
export const calloutBlock: Block = {
	slug: "callout",
	fields: [
		{ name: "tone", type: "select", options: ["info", "warning"] },
		{ name: "body", type: "text" },
	],
};
