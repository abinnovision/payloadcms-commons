import { createMontage } from "@abinnovision/payloadcms-montage";

import type { TypedLocale } from "payload";
import type { ComponentType, ReactNode } from "react";

/**
 * Montage takes no dependency on Next. `Link` reaches block components
 * through this context, injected once by the route, rather than through an
 * import inside a block component.
 */
export interface AppContext {
	/**
	 * True only inside the admin's live preview. Montage knows nothing about
	 * preview; the flag travels through the app's own context, like `Link`.
	 */
	isPreview: boolean;
	/**
	 * The locale the route resolved the path in, for the blocks that query
	 * with it. Turning a mapping into an href does not need it here: the
	 * wayfinder router on the context was built with the locale and the href
	 * formatter already bound.
	 */
	locale: TypedLocale;
	Link: ComponentType<{ href: string; children: ReactNode }>;
}

export const {
	defineBlockComponent,
	defineInlineBlockComponent,
	defineBlockRegistry,
	createRenderer,
} = createMontage<AppContext>();
