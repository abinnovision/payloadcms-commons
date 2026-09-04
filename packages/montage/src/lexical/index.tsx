import type { BlockContext, Renderer } from "../types.js";
import type { JSXConverters } from "@payloadcms/richtext-lexical/react";

/**
 * Renders (and resolves, since `node.fields` is the same object reference
 * the resolver's traversal sees) any block registered on `renderer` when it
 * is embedded in richtext. A separate entrypoint rather than a member of
 * `Renderer`, so the optional `@payloadcms/richtext-lexical` peer's
 * `JSXConverters` type never leaks into the core `.` entry's `.d.mts` for
 * consumers who have not installed it.
 */
export const lexicalConverters = <TCtx,>(
	renderer: Renderer<TCtx>,
	ctx: BlockContext<TCtx>,
): JSXConverters => {
	return {
		blocks: new Proxy(
			{},
			{
				get(_target, slug) {
					if (typeof slug !== "string" || !renderer.isRegistered(slug)) {
						return undefined;
					}

					return ({ node }: { node: { fields: unknown } }) => (
						<renderer.Block block={node.fields} ctx={ctx} />
					);
				},
			},
		),
	};
};
