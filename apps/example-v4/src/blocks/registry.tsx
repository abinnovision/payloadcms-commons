import { CalloutModule } from "./CalloutModule";
import { CallToAction } from "./CallToAction";
import { HeroModule } from "./HeroModule";
import { RecentPostsModule } from "./RecentPostsModule";
import { RichTextModule } from "./RichTextModule";
import { SectionWrapper } from "./SectionWrapper";
import { defineBlockRegistry } from "../montage";

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
	},
);
