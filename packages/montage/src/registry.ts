import type {
	BlockContext,
	BlockComponent,
	BlockRegistry,
	BlockWrapper,
	InternalBlockEntry,
	InternalRegistry,
} from "./types.js";

/**
 * Builds the registry from `entries`, keyed by slug. Dispatch uses the
 * object key, and the type-level mapped constraint (declared on
 * `Montage["defineBlockRegistry"]`) already guarantees each component's own
 * slug matches its key, so this runtime pass does no further validation.
 */
export const buildRegistry = <TCtx>(
	entries: Record<string, BlockComponent>,
	canRender:
		| ((args: {
				block: { blockType?: string };
				ctx: BlockContext<TCtx>;
		  }) => boolean)
		| undefined,
	wrapBlock: BlockWrapper<TCtx> | undefined,
): BlockRegistry => {
	const map = new Map<string, InternalBlockEntry>();
	for (const [slug, component] of Object.entries(entries)) {
		map.set(slug, component as unknown as InternalBlockEntry);
	}

	return {
		entries: map,
		canRender,
		wrapBlock,
	} as unknown as InternalRegistry;
};
