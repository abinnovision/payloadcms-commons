import type { BlockContext, MontageSlots } from "./types.js";

/**
 * Creates a render context from the consumer's own base shape. Montage adds
 * no fields; it only reserves the `montage:` key prefix for its own use.
 */
export const createBlockContext = <T extends object>(
	base: T,
): BlockContext<T> => {
	return base;
};

/**
 * Shallow-clones a context for a child render. This is what makes the
 * `montage:` results slot shared by reference between parent and child:
 * resolving before cloning is required, since a clone taken first would
 * carry no results.
 */
export const createChildContext = <T>(
	parent: BlockContext<T>,
): BlockContext<T> => {
	return { ...parent };
};

export interface ContextExtension<V> {
	get: (ctx: MontageSlots) => V | undefined;
	set: (ctx: MontageSlots, value: V) => void;
}

/**
 * Creates a typed slot on the `montage:` namespace for consumer-defined
 * parent-to-child signalling (an "is this the first section" flag, for
 * example). Extension names share one namespace, so two libraries choosing
 * the same `name` collide; prefix with the owning package to avoid it.
 */
export const createContextExtension = <V>(
	name: string,
): ContextExtension<V> => {
	const key: `montage:${string}` = `montage:${name}`;

	return {
		get: (ctx) => ctx[key] as V | undefined,
		set: (ctx, value) => {
			ctx[key] = value;
		},
	};
};
