import { AppLink } from "../components/AppLink";
import { defineBlockComponent } from "../montage";

import type { links } from "../links";
import type { LinkDataOf } from "@abinnovision/payloadcms-wayfinder";

/**
 * Hands the authored link to `AppLink` and nothing else. The mappings, the
 * locale and the href formatter all travel on the render context the block was
 * already given, so a block that renders a link needs no wayfinder import.
 */
export const CallToAction = defineBlockComponent("call-to-action-module", {
	component: ({ block, ctx }) => (
		<section>
			<h2>{block.heading}</h2>
			<AppLink
				ctx={ctx}
				link={block.link as LinkDataOf<typeof links> | undefined}
			/>
		</section>
	),
});
