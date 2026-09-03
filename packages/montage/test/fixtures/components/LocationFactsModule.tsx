import { defineBlockComponent } from "../montage.js";

/**
 * A `ctx`-only predicate with no resolver at all. Proves `canRender` args
 * are usable without declaring `resolve` (WP4 falsifier).
 */
export const LocationFactsModule = defineBlockComponent(
	"location-facts-module",
	{
		canRender: ({ ctx }) => ctx.document.identifier.value.length > 0,
		component: ({ ctx }) => `facts for ${ctx.document.identifier.value}`,
	},
);
