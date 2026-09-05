import { defineBlockComponent } from "../montage";

export const HeroModule = defineBlockComponent("hero-module", {
	component: ({ block }) => (
		<section>
			<h1 style={{ fontSize: block.imageSize === "large" ? "3rem" : "2rem" }}>
				{block.title}
			</h1>
			{block.subtitle ? <p>{block.subtitle}</p> : null}
		</section>
	),
});
