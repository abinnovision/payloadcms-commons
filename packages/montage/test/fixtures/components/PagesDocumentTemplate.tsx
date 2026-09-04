import { defineInlineBlockComponent } from "../montage.js";
import { PageLayout } from "./PageLayout.js";

import type { PagesDocumentTemplateBlock } from "../blocks.js";

export interface PagesDocumentTemplateMeta {
	title: string;
}

/**
 * A document-template pattern: a synthetic root, not a Payload block, given
 * a literal `blockType` so slug checking still works (WP7 falsifier: "a
 * synthetic root with no `id` resolves under identity keying" — this one
 * legitimately has an `id`; the no-`id` case is the dedicated "document
 * template" test).
 *
 * `resolve` stands in for a document-level resolver whose result
 * `generateMetadata` reads without running any block resolver
 * (`scope: "root"`).
 */
export const PagesDocumentTemplate =
	defineInlineBlockComponent<PagesDocumentTemplateBlock>()(
		"pages-document-template",
		{
			resolve: ({ block }): PagesDocumentTemplateMeta => ({
				title: block.title,
			}),
			component: ({ block, ctx, renderer }) =>
				PageLayout({ data: block.layout, ctx, renderer }),
		},
	);
