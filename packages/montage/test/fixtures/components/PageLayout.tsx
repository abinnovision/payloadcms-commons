import { createChildContext } from "../../../src/context.js";
import { asText } from "../as-text.js";
import { isFirstSection } from "../context.js";

import type { BlockContext, Renderer } from "../../../src/types.js";
import type { PageLayoutData } from "../blocks.js";
import type { AppContext } from "../context.js";

/**
 * A page-shell layout, built entirely from public montage capabilities.
 * Plain component, not a montage block: `renderer.Block` and
 * `createChildContext` are the only engine capabilities it needs (WP4
 * falsifier).
 */
export const PageLayout = (args: {
	data: PageLayoutData;
	ctx: BlockContext<AppContext>;
	renderer: Renderer<AppContext>;
}): string => {
	const { data, ctx, renderer } = args;

	const header = data.header?.[0]
		? asText(renderer.Block({ block: data.header[0], ctx }))
		: "";
	const sections = data.sections.map((section, i) => {
		const childCtx = createChildContext(ctx);
		isFirstSection.set(childCtx, i === 0);

		return asText(renderer.Block({ block: section, ctx: childCtx }));
	});
	const footer = data.footer?.[0]
		? asText(renderer.Block({ block: data.footer[0], ctx }))
		: "";

	return [header, ...sections, footer].filter(Boolean).join(" | ");
};
