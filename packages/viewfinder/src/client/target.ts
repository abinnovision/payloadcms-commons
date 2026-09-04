import {
	BLOCK_ID_ATTRIBUTE,
	BLOCK_TYPE_ATTRIBUTE,
	FIELD_ATTRIBUTE,
} from "../attributes.js";

import type { BlockAddress } from "../protocol.js";

/**
 * The slice of `Element` this resolution needs. Narrowed so the logic stays
 * testable without a layout engine — everything geometric lives in
 * `geometry.ts`, and everything decision-shaped lives here.
 *
 * Method syntax, not property syntax: `strictFunctionTypes` checks
 * function-typed properties contravariantly, which would stop a real
 * `Element` from satisfying this interface.
 */
export interface TargetElement {
	/* eslint-disable @typescript-eslint/method-signature-style -- see above */
	closest(selector: string): TargetElement | null;
	getAttribute(name: string): string | null;
	/* eslint-enable @typescript-eslint/method-signature-style */
}

export interface ResolvedTarget<TElement> {
	element: TElement;
	address: BlockAddress;
}

const BLOCK_SELECTOR = `[${BLOCK_ID_ATTRIBUTE}]`;
const FIELD_SELECTOR = `[${FIELD_ATTRIBUTE}]`;

/**
 * Walks up from an event target to the block it belongs to, and to the field
 * inside that block when one is marked.
 *
 * A field marker only counts when its own nearest block is this block. A
 * block nested inside a marked field of its parent would otherwise report the
 * parent's field name as its own.
 *
 * Generic over the concrete element type so callers get their own `Element`
 * back; `closest` is declared as returning the structural type, so the one
 * narrowing cast lives here rather than at every call site.
 */
export const resolveTarget = <TElement extends TargetElement>(
	target: TElement | null,
): ResolvedTarget<TElement> | undefined => {
	const element = (target?.closest(BLOCK_SELECTOR) ?? null) as TElement | null;
	const id = element?.getAttribute(BLOCK_ID_ATTRIBUTE);
	if (!element || id === null || id === undefined || id.length === 0) {
		return undefined;
	}

	const blockType = element.getAttribute(BLOCK_TYPE_ATTRIBUTE);
	const fieldElement = target?.closest(FIELD_SELECTOR) ?? null;
	const field =
		fieldElement?.closest(BLOCK_SELECTOR) === element
			? fieldElement.getAttribute(FIELD_ATTRIBUTE)
			: null;

	return {
		element,
		address: {
			id,
			...(blockType === null ? {} : { blockType }),
			...(field === null ? {} : { field }),
		},
	};
};
