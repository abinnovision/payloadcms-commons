import { AppLink } from "../components/AppLink";
import { defineBlockComponent } from "../montage";

/**
 * Hands the authored link to `AppLink` and nothing else.
 *
 * The router travels on the render context the block was already given, with
 * the mappings, the locale and the href formatter bound into it, so a block
 * that renders a link needs no wayfinder import — and the link goes through
 * untouched, because the generated field type is the shape the resolver
 * accepts.
 */
export const CallToAction = defineBlockComponent("call-to-action-module", {
	component: ({ block, ctx }) => (
		<section>
			<h2>{block.heading}</h2>
			<AppLink ctx={ctx} link={block.link} />
		</section>
	),
});
