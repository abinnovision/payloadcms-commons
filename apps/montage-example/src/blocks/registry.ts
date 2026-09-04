import { HeroModule } from "./HeroModule";
import { RecentPostsModule } from "./RecentPostsModule";
import { SectionWrapper } from "./SectionWrapper";
import { defineBlockRegistry } from "../montage";

export const blocks = defineBlockRegistry(
	{
		"hero-module": HeroModule,
		"recent-posts-module": RecentPostsModule,
		"section-wrapper": SectionWrapper,
	},
	{ require: ["hero-module", "recent-posts-module"] },
);
