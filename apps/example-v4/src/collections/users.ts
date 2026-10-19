import type { CollectionConfig } from "payload";

export const users: CollectionConfig = {
	slug: "users",
	auth: true,
	admin: { useAsTitle: "email" },
	fields: [],
	// Payload 4 versions every collection by default; auth collections opt out.
	versions: false,
};
