import { defineInlineBlockComponent } from "../montage.js";

import type { GlobalReferenceBlock } from "../blocks.js";

/**
 * One level of indirection to a populated relationship value. Proves a
 * block reached through a relationship still renders (WP4 falsifier).
 */
export const GlobalReference =
	defineInlineBlockComponent<GlobalReferenceBlock>()("global-reference", {
		component: ({ block, ctx, renderer }) =>
			renderer.Block({ block: block.reference, ctx }),
	});
