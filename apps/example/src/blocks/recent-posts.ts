import type { Block } from "payload";

/** Real Payload block config, registered through `montagePlugin`. */
export const recentPostsBlock: Block = {
	slug: "recent-posts-module",
	interfaceName: "RecentPostsModuleBlock",
	fields: [{ name: "limit", type: "number", required: true, defaultValue: 3 }],
};
