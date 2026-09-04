import { defineInlineBlockComponent } from "../montage.js";
import { PageLayout } from "./PageLayout.js";

import type { PagesDocumentTemplateBlock } from "../blocks.js";

export interface PagesDocumentTemplateMeta {
	title: string;
}

/**
 * A document-template pattern: a synthetic root rather than a Payload block,
 * given a literal `blockType` so slug checking still works. This fixture
 * legitimately has an `id`. The WP7 falsifier "a synthetic root with no `id`
 * resolves under identity keying" is covered by the dedicated "document
 * template" test.
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
