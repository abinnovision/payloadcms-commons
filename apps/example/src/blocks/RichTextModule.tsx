import { lexicalConverters } from "@abinnovision/payloadcms-montage/lexical";
import { RichText } from "@payloadcms/richtext-lexical/react";

import { AppLink } from "../components/AppLink";
import { defineBlockComponent } from "../montage";

import type { LinkNodeFields } from "../components/AppLink";
import type { ReactNode } from "react";

/**
 * The block tree continues inside the rich text. `lexicalConverters` hands
 * every embedded block node back to this renderer, so `callout` renders
 * through its registered component and `wrapBlock` still runs on it — which
 * is what makes a Lexical-embedded block addressable in live preview.
 *
 * The `link` converter is the read side of `wayfinderLinkFeature`. It renders
 * through the same `AppLink` a block does, so a link typed into a paragraph
 * and a link authored in a field cannot disagree about how they resolve.
 */
export const RichTextModule = defineBlockComponent("rich-text-module", {
	// The field is localized and optional, so a block filled in one locale is
	// empty in the other. Collapsing beats rendering an empty paragraph.
	canRender: ({ block }) => Boolean(block.content),
	component: ({ block, ctx, renderer }) =>
		block.content ? (
			<RichText
				converters={({ defaultConverters }) => ({
					...defaultConverters,
					...lexicalConverters(renderer, ctx),
					link: ({ node, nodesToJSX }) => (
						<AppLink ctx={ctx} node={node.fields as LinkNodeFields}>
							{nodesToJSX({ nodes: node.children }) as ReactNode}
						</AppLink>
					),
				})}
				data={block.content}
			/>
		) : null,
});
