import type { GlobalConfig } from "payload";

export const siteSettings: GlobalConfig = {
	slug: "site-settings",
	label: "Site Settings",
	admin: {
		description: "Settings shared by every page, such as the site title.",
	},
	versions: { drafts: true },
	fields: [
		{
			name: "title",
			type: "text",
			required: true,
			localized: true,
			admin: { description: "Shown in the browser tab and in search results." },
		},
		{
			name: "sections",
			type: "blocks",
			blocks: [],
			blockReferences: ["richText"],
		},
	],
};
