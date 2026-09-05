import type { Block } from "payload";

/**
 * Lives inside a rich text field rather than a blocks field. It is registered
 * through `montagePlugin` like any other block, so the same component renders
 * it whether it is embedded in Lexical or nested in a blocks field.
 */
export const calloutBlock: Block = {
	slug: "callout",
	interfaceName: "CalloutBlock",
	fields: [
		{
			name: "tone",
			type: "select",
			options: ["info", "warning"],
			defaultValue: "info",
		},
		{ name: "body", type: "textarea", required: true },
	],
};
