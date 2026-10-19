import { sectionWrapperBlock } from "../blocks/section-wrapper";

import type { Article } from "../payload-types";
import type { CollectionAfterChangeHook, CollectionConfig } from "payload";

/*
 * Queued with `req`, so the job is written in the same transaction as the
 * publish and disappears with it if that rolls back.
 */
const queueOnPublish: CollectionAfterChangeHook<Article> = async ({
	doc,
	previousDoc,
	req,
}) => {
	if (doc._status === "published" && previousDoc._status !== "published") {
		await req.payload.jobs.queue({
			workflow: "article-published",
			input: { articleId: doc.id },
			req,
		});
	}

	return doc;
};

/**
 * Articles sit under their section, so their pattern takes two parameters. The
 * last one identifies the article; the first narrows the lookup.
 *
 * They carry the same `layout` field as pages, which is what lets the one
 * catch-all route render either without branching on the collection it got.
 */
export const articles: CollectionConfig = {
	slug: "articles",
	trash: true,
	admin: {
		useAsTitle: "title",
		defaultColumns: ["title", "section", "slug"],
		livePreview: {
			url: ({ data, locale }) =>
				`/preview?collection=articles&id=${String(data["id"] ?? "")}&locale=${locale.code}`,
		},
	},
	versions: { drafts: { schedulePublish: true } },
	defaultPopulate: { slug: true, title: true, section: true },
	hooks: { afterChange: [queueOnPublish] },
	fields: [
		{ name: "title", type: "text", required: true, localized: true },
		{ name: "slug", type: "text", required: true },
		{
			name: "section",
			type: "relationship",
			relationTo: "sections",
			required: true,
		},
		{
			name: "layout",
			type: "blocks",
			required: true,
			blocks: [],
			blockReferences: [sectionWrapperBlock, "rich-text-module"],
		},
	],
};
