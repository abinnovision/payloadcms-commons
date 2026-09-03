import { asText } from "../as-text.js";
import { isFirstSection } from "../context.js";
import { defineInlineBlockComponent } from "../montage.js";

import type { SectionWrapperBlock } from "../blocks.js";

/**
 * A section wrapper collapsing when none of its modules can render. No
 * import of a renderer: `renderer` arrives in the arguments, which is what
 * keeps montage reentrant and avoids a cycle between the registry and its
 * components.
 */
export const SectionWrapper = defineInlineBlockComponent<SectionWrapperBlock>()(
	"section-wrapper",
	{
		component: ({ block, ctx, renderer }) => {
			const visible = block.modules.filter((m) =>
				renderer.canRender({ block: m, ctx }),
			);
			if (visible.length === 0) {
				return null;
			}

			const rendered = visible
				.map((m) => asText(renderer.Block({ block: m, ctx })))
				.join(", ");

			return `section${isFirstSection.get(ctx) ? " (first)" : ""}: ${rendered}`;
		},
	},
);
