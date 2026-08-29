import {
	BlocksFeature,
	HeadingFeature,
	LinkFeature,
	ParagraphFeature,
	lexicalEditor,
} from "@payloadcms/richtext-lexical";

import {
	badgeBlock,
	ctaBlock,
	richTextBlock,
	sectionWrapperBlock,
} from "./blocks.js";

import type { CollectionConfig } from "payload";

/**
 * Editor carrying every kind of node sub-schema: blocks by slug, inline blocks
 * by slug, and a link whose fields were extended beyond the defaults.
 */
const postContentEditor = lexicalEditor({
	features: ({ defaultFeatures }) => [
		...defaultFeatures.filter((feature) => feature.key !== "link"),
		BlocksFeature({ blocks: ["callout"], inlineBlocks: [badgeBlock] }),
		LinkFeature({
			fields: ({ defaultFields }) => [
				...defaultFields,
				{ name: "rel", type: "select", options: ["nofollow", "sponsored"] },
			],
		}),
	],
});

export const users: CollectionConfig = {
	slug: "users",
	auth: true,
	fields: [],
};

export const pages: CollectionConfig = {
	slug: "pages",
	admin: { description: "Marketing pages rendered on the public site." },
	versions: { drafts: true },
	fields: [
		{
			type: "tabs",
			tabs: [
				{
					label: "General",
					fields: [
						{
							name: "title",
							type: "text",
							required: true,
							localized: true,
							admin: {
								description: { en: "Page title", de: "Seitentitel" },
							},
						},
						{
							name: "slug",
							type: "text",
							required: true,
							admin: { description: "URL segment of the page, lowercase." },
						},
					],
				},
				{
					name: "layout",
					fields: [
						{
							name: "color",
							type: "select",
							options: ["light", "dark"],
						},
						{
							name: "sections",
							type: "blocks",
							required: true,
							blocks: [],
							blockReferences: [sectionWrapperBlock, richTextBlock],
						},
					],
				},
			],
		},
		{
			name: "meta",
			type: "group",
			admin: { description: "Search engine metadata." },
			fields: [
				{
					name: "title",
					type: "text",
					admin: { description: () => "resolved in the admin UI only" },
				},
			],
		},
	],
};

export const posts: CollectionConfig = {
	slug: "posts",
	versions: { drafts: true },
	fields: [
		{ name: "title", type: "text", required: true, maxLength: 120 },
		{
			name: "content",
			type: "richText",
			localized: true,
			editor: postContentEditor,
		},
		{
			name: "summary",
			type: "richText",
			editor: lexicalEditor({
				features: [
					ParagraphFeature(),
					HeadingFeature({ enabledHeadingSizes: ["h4"] }),
				],
			}),
		},
		{
			name: "tags",
			type: "relationship",
			relationTo: "tags",
			hasMany: true,
		},
		/*
		 * Read-only container: every field beneath it inherits the flag, which
		 * gives each patch operation a scalar, a list element, a block and a
		 * rich text field it must refuse.
		 */
		{
			name: "locked",
			type: "group",
			admin: { readOnly: true },
			fields: [
				{ name: "note", type: "text" },
				{
					name: "entries",
					type: "array",
					fields: [{ name: "label", type: "text" }],
				},
				{ name: "sections", type: "blocks", blocks: [ctaBlock] },
				{ name: "body", type: "richText" },
			],
		},
		{
			name: "items",
			type: "array",
			minRows: 1,
			maxRows: 4,
			admin: { description: "Repeated content rows." },
			fields: [
				{ name: "heading", type: "text", localized: true },
				{
					name: "actions",
					type: "blocks",
					minRows: 1,
					maxRows: 2,
					blocks: [ctaBlock],
				},
			],
		},
	],
};

export const tags: CollectionConfig = {
	slug: "tags",
	fields: [{ name: "name", type: "text", required: true }],
};
