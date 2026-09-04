import { Marked } from "@abinnovision/payloadcms-viewfinder/client";

import { HeroModule } from "./HeroModule";
import { RecentPostsModule } from "./RecentPostsModule";
import { SectionWrapper } from "./SectionWrapper";
import { defineBlockRegistry } from "../montage";

import type { ReactNode } from "react";

export const blocks = defineBlockRegistry(
	{
		"hero-module": HeroModule,
		"recent-posts-module": RecentPostsModule,
		"section-wrapper": SectionWrapper,
	},
	{
		require: ["hero-module", "recent-posts-module"],
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
