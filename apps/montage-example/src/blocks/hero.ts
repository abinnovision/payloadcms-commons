import type { Block } from "payload";

/** Real Payload block config, registered through `montagePlugin`. */
export const heroBlock: Block = {
	slug: "hero-module",
	interfaceName: "HeroModuleBlock",
	fields: [{ name: "title", type: "text", required: true }],
};
