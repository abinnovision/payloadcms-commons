import { defineBlockComponent } from "../montage.js";

export const HeroModule = defineBlockComponent("hero-module", {
	component: ({ block }) => block.title,
});
