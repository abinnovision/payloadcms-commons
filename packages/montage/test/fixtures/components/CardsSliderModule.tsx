import { defineBlockComponent } from "../montage.js";

import type { ItemDetailModuleBlock } from "../blocks.js";

export interface CardItem {
	id: string;
	title: string;
	/** Full related document, the way a depth-populated relationship arrives. */
	layout: ItemDetailModuleBlock[];
}

/**
 * A resolver plus a data-reading predicate, used together: `canRender`
 * collapses the block when the resolver returns no items. The resolver
 * returns whole related "documents" (each with its own `layout`), which is
 * exactly the shape that must not be traversed further without `expands`.
 */
export const CardsSliderModule = defineBlockComponent("cards-slider-module", {
	resolve: ({ block }) => {
		const items: CardItem[] = Array.from({ length: block.limit }, (_, i) => ({
			id: `item-${String(i)}`,
			title: `Item ${String(i)}`,
			layout: [
				{
					blockType: "item-detail-module",
					id: `detail-${String(i)}`,
					itemId: String(i),
				},
			],
		}));

		return { items };
	},
	canRender: ({ data }) => data.items.length > 0,
	component: ({ data }) => `slider with ${String(data.items.length)} items`,
});
