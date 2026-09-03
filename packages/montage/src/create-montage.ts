import { createRenderer } from "./create-renderer.js";
import {
	defineBlockComponent,
	defineInlineBlockComponent,
} from "./define-block-component.js";
import { buildRegistry } from "./registry.js";

import type { Montage } from "./types.js";

/**
 * The single binding site. `TCtx` (the consumer's own context shape) has no
 * natural inference site elsewhere: it appears only inside callback
 * parameters, which are inference targets rather than sources. Currying
 * rescues `D` for one factory but does not scale to a second parameter, so
 * the whole surface is bound once here instead.
 */
export const createMontage = <TCtx extends object>(): Montage<TCtx> => {
	return {
		defineBlockComponent:
			defineBlockComponent as Montage<TCtx>["defineBlockComponent"],
		defineInlineBlockComponent:
			defineInlineBlockComponent as Montage<TCtx>["defineInlineBlockComponent"],
		defineBlockRegistry: (entries, options) =>
			buildRegistry<TCtx>(entries, options?.canRender),
		createRenderer: (registry) => createRenderer<TCtx>(registry),
	};
};
