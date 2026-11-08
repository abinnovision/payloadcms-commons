import type { CollectionConfig } from "payload";

export const users: CollectionConfig = {
	slug: "users",
	auth: true,
	admin: { useAsTitle: "email" },
	fields: [
		{
			name: "agentAccess",
			type: "checkbox",
			defaultValue: false,
			// The seed sets it; nobody can grant it through the admin or the API.
			access: { create: () => false, update: () => false },
			admin: {
				description: "May chat with the reviewer agent. Set by the seed.",
			},
		},
	],
	// Payload 4 versions every collection by default; auth collections opt out.
	versions: false,
};
