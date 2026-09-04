import type {
	BlockComponent,
	BlockComponentOptions,
	InternalBlockEntry,
} from "./types.js";
import type { BlockSlug, TypedBlock } from "payload";

/**
 * Blocks registered in `config.blocks`. The slug is checked against
 * `BlockSlug`, and the block's props are inferred from it with no generics
 * the caller has to write.
 *
 * `TCtx` is bound once by `createMontage<TCtx>()`, which is why it does not
 * appear as a generic parameter here: this function is asserted against the
 * `TCtx`-bound member signature at that single boundary in
 * `create-montage.ts`, rather than threaded through every call site.
 */
export const defineBlockComponent = <S extends BlockSlug, D = undefined>(
	slug: S,
	options: BlockComponentOptions<TypedBlock[S], D, unknown>,
): BlockComponent<S> => {
	const entry: InternalBlockEntry = {
		slug,
		expands: options.expands ?? false,
		resolve: options.resolve as InternalBlockEntry["resolve"],
		canRender: options.canRender as InternalBlockEntry["canRender"],
		component: options.component as InternalBlockEntry["component"],
	};

	return entry as unknown as BlockComponent<S>;
};

/**
 * Blocks declared inline in a field, which never reach `config.blocks`
 * (the section wrapper, global references, document templates, ...).
 * Curried so `D` still infers once `TBlock` is supplied explicitly: `TBlock`
 * sits in an indexed-access position (`TBlock["blockType"]`), not an
 * inference site, so it must be given explicitly, and TypeScript has no
 * partial type-argument inference. Supplying it in a single call would pin
 * `D` to its default.
 */
export const defineInlineBlockComponent =
	<TBlock extends { blockType: string }>() =>
	<D = undefined>(
		slug: TBlock["blockType"],
		options: BlockComponentOptions<TBlock, D, unknown>,
	): BlockComponent<TBlock["blockType"]> => {
		const entry: InternalBlockEntry = {
			slug,
			expands: options.expands ?? false,
			resolve: options.resolve as InternalBlockEntry["resolve"],
			canRender: options.canRender as InternalBlockEntry["canRender"],
			component: options.component as InternalBlockEntry["component"],
		};

		return entry;
	};
