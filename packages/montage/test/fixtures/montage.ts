import { createMontage } from "../../src/create-montage.js";

import type { AppContext } from "./context.js";

/**
 * The single binding site (§"One binding site" in the plan), called once at
 * module scope, as a real consumer would.
 */
export const {
	defineBlockComponent,
	defineInlineBlockComponent,
	defineBlockRegistry,
	createRenderer,
} = createMontage<AppContext>();
