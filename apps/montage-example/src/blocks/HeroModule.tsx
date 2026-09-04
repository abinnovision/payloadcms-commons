import { defineBlockComponent } from "../montage";

export const HeroModule = defineBlockComponent("hero-module", {
	component: ({ block, ctx }) => (
		<section>
			<h1>{block.title}</h1>
			<ctx.Link href="/">Back home</ctx.Link>
		</section>
	),
});
