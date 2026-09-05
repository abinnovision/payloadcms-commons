import { Marked } from "@abinnovision/payloadcms-viewfinder/client";

import { CalloutModule } from "./CalloutModule";
import { CallToAction } from "./CallToAction";
import { HeroModule } from "./HeroModule";
import { RecentPostsModule } from "./RecentPostsModule";
import { RichTextModule } from "./RichTextModule";
import { SectionWrapper } from "./SectionWrapper";
import { defineBlockRegistry } from "../montage";

import type { ReactNode } from "react";

export const blocks = defineBlockRegistry(
	{
		callout: CalloutModule,
		"call-to-action-module": CallToAction,
		"hero-module": HeroModule,
		"recent-posts-module": RecentPostsModule,
		"rich-text-module": RichTextModule,
		"section-wrapper": SectionWrapper,
	},
	{
		require: [
			"callout",
			"call-to-action-module",
			"hero-module",
			"recent-posts-module",
			"rich-text-module",
		],
		/*
		 * Montage's one dispatch choke point runs for every block at every
		 * depth, so this alone makes the whole tree addressable from the admin
		 * — nested modules and richtext-embedded blocks included. Outside
		 * preview `Marked` renders its children untouched.
		 */
		wrapBlock: ({ block, ctx, children }) => (
			<Marked
				blockType={block.blockType}
				enabled={ctx.isPreview}
				id={(block as { id?: string | null }).id ?? ""}
			>
				{children as ReactNode}
			</Marked>
		),
	},
);
