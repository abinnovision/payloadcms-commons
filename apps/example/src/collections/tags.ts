import type { CollectionConfig } from "payload";

export const tags: CollectionConfig = {
	slug: "tags",
	admin: { useAsTitle: "name" },
	trash: true,
	fields: [{ name: "name", type: "text", required: true }],
};
