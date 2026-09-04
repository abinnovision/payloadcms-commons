import type { CollectionConfig } from "payload";

/** Fetched by `recent-posts-module`'s resolver, never rendered directly. */
export const posts: CollectionConfig = {
	slug: "posts",
	admin: { useAsTitle: "title" },
	fields: [
		{ name: "title", type: "text", required: true },
		{ name: "slug", type: "text", required: true },
		{ name: "excerpt", type: "text" },
	],
};
