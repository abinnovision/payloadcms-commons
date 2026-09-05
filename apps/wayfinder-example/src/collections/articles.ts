import { linkField } from "@abinnovision/payloadcms-wayfinder/config";

import { links } from "../links";

import type { CollectionConfig } from "payload";

/**
 * Articles sit under their section, so their pattern takes two parameters. The
 * last one identifies the article; the first narrows the lookup.
 */
export const articles: CollectionConfig = {
	slug: "articles",
	admin: { useAsTitle: "title", defaultColumns: ["title", "section", "slug"] },
	versions: { drafts: true },
	defaultPopulate: { slug: true, title: true, section: true },
	fields: [
		{ name: "title", type: "text", required: true },
		{ name: "slug", type: "text", required: true },
		{
			name: "section",
			type: "relationship",
			relationTo: "sections",
			required: true,
		},
		{ name: "body", type: "textarea" },
		/*
		 * A link authored here routes through the mapping, so editing a
		 * collection's pattern in the admin panel moves every link to it.
		 */
		linkField({
			relationTo: ["pages", "articles", "sections"],
			required: false,
			withLabel: true,
			links,
		}),
	],
};
