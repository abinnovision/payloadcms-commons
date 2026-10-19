import type { CollectionConfig } from "payload";

export const tags: CollectionConfig = {
	slug: "tags",
	admin: { useAsTitle: "name" },
	trash: true,
	fields: [{ name: "name", type: "text", required: true }],
	// Payload 4 enables versions by default; this collection keeps the v3 schema.
	versions: false,
};
