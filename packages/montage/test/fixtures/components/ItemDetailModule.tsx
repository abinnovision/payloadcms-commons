import { defineBlockComponent } from "../montage.js";

/**
 * Lives inside a document a slider-like resolver returns. Its own resolver
 * must never run when the slider's resolver has `expands: false` (WP7
 * falsifier: "a resolver returning documents").
 */
export const ItemDetailModule = defineBlockComponent("item-detail-module", {
	resolve: () => ({ shouldNotRun: true }),
	component: ({ block }) => `item ${block.itemId}`,
});
