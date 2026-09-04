import { createMontage } from "@abinnovision/payloadcms-montage";

import type { ComponentType, ReactNode } from "react";

/**
 * Montage takes no dependency on Next. `Link` and `Image` reach block
 * components through this context, injected once by the route, rather than
 * through an import inside a block component.
 */
export interface AppContext {
	/**
	 * True only inside the admin's live preview. Montage knows nothing about
	 * preview; the flag travels through the app's own context, like `Link`.
	 */
	isPreview: boolean;
	Link: ComponentType<{ href: string; children: ReactNode }>;
	Image: ComponentType<{
		src: string;
		alt: string;
		width: number;
		height: number;
	}>;
}

export const {
	defineBlockComponent,
	defineInlineBlockComponent,
	defineBlockRegistry,
	createRenderer,
} = createMontage<AppContext>();
