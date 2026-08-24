import type { Block } from "payload";

/**
 * Placed inside a rich text field rather than a blocks field, so
 * `describeSchema` has a Lexical block node to drill into.
 */
export const calloutBlock: Block = {
	slug: "callout",
	fields: [
		{ name: "tone", type: "select", options: ["info", "warning"] },
		{ name: "body", type: "textarea" },
	],
};
