import { createMontage } from "@abinnovision/payloadcms-montage";

import type { FormatHref } from "@abinnovision/payloadcms-wayfinder";
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
	 * The locale the route resolved the path in. Blocks need it to turn a
	 * wayfinder mapping into an href, since a mapping holds one pattern per
	 * locale.
	 */
	locale: TypedLocale;
	/**
	 * Puts the locale prefix back on any path a block emits. Built once per
	 * request and threaded alongside the mappings, since a link resolved
	 * without it leaves the locale it was rendered in.
	 */
	formatHref: FormatHref;
	Link: ComponentType<{ href: string; children: ReactNode }>;
}

export const {
	defineBlockComponent,
	defineInlineBlockComponent,
	defineBlockRegistry,
	createRenderer,
} = createMontage<AppContext>();
