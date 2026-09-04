import { createBlockTree } from "./block-tree.js";
import {
	checkIdentity,
	getBlockData as rawGetBlockData,
	resolveBlockData,
} from "./resolver/execute.js";

import type {
	BlockContext,
	BlockRegistry,
	BlockWrapper,
	InternalRegistry,
	Renderer,
} from "./types.js";

/**
 * Binds a registry to a fresh, self-contained renderer. Never a module-level
 * singleton: two calls with the same registry (two consumers in one
 * process, or an example app plus its tests) do not share state.
 */
export const createRenderer = <TCtx>(
	registry: BlockRegistry,
): Renderer<TCtx> => {
	const internal = registry as unknown as InternalRegistry;

	const dispatch = createBlockTree<TCtx>(
		internal.entries,
		internal.canRender,
		internal.wrapBlock as BlockWrapper<TCtx> | undefined,
	);

	return {
		...dispatch,
		resolveBlockData: (args) =>
			resolveBlockData({
				root: args.root,
				ctx: args.ctx,
				entries: internal.entries,
				scope: args.scope,
				maxPasses: args.maxPasses,
			}),
		// `D` lets callers narrow the return type explicitly at the call site.
		// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
		getBlockData: <D>(ctx: BlockContext<TCtx>, node: object) => {
			checkIdentity(ctx, node, internal.entries);

			return rawGetBlockData<D>(ctx, node);
		},
	};
};
