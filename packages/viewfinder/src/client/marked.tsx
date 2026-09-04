"use client";

import { cloneElement, isValidElement } from "react";

import { BLOCK_ID_ATTRIBUTE, markBlock } from "../attributes.js";

import type { ReactElement, ReactNode } from "react";

/**
 * `display: contents` removes the wrapper from layout entirely, so marking a
 * block cannot change how it renders. The cost is that the wrapper has no box
 * of its own; `measureElement` handles that.
 */
const CONTENTS = { display: "contents" } as const;

type HostElement = ReactElement<Record<string, unknown>>;

/**
 * Whether this is a DOM element, as opposed to a component element, a
 * fragment, a promise or text.
 *
 * `typeof type === "string"` is what makes marking it safe: a host element
 * puts every unknown prop into the markup, so the attributes are certain to
 * land. A component element might forward them to its root or drop them, and
 * there is no way to tell which from here.
 */
const isHostElement = (node: ReactNode): node is HostElement =>
	isValidElement(node) && typeof node.type === "string";

export interface MarkedProps {
	/** The Payload row id of this block. */
	id: string;
	/**
	 * Shown in the preview overlay so editors can tell blocks apart.
	 *
	 * Explicitly `| undefined` so that under `exactOptionalPropertyTypes` a
	 * caller can forward a possibly-absent value straight through, which is
	 * what a generic wrapper around a block registry has to do.
	 */
	blockType?: string | undefined;
	/**
	 * Gate this on your own preview flag. When false the children render
	 * untouched, with no wrapper and no attributes, so production output is
	 * unaffected by having viewfinder installed.
	 */
	enabled?: boolean | undefined;
	children: ReactNode;
}

/**
 * Makes one block addressable from the admin.
 *
 * Marks the block's own root element where there is one, and falls back to a
 * `display: contents` wrapper where there is not. The wrapper preserves
 * layout but is still an element in the tree: it breaks `>` and
 * `:nth-child()` selectors aimed at the block, the HTML parser reparents it
 * out of a table or a paragraph, and it has no box, so the overlay measures a
 * range over its children rather than a rect.
 *
 * A block can also spread `markBlock()` onto its own element and skip this
 * component altogether. That is the same outcome as the marked branch here,
 * stated by the block rather than inferred.
 */
export const Marked = (props: MarkedProps): ReactNode => {
	if (props.enabled === false || props.id.length === 0) {
		return props.children;
	}

	const attributes = markBlock(props.id, props.blockType);

	if (isHostElement(props.children)) {
		/* Already marked: the block said where its id goes, so leave it there. */
		return props.children.props[BLOCK_ID_ATTRIBUTE] === undefined
			? cloneElement(props.children, { ...attributes })
			: props.children;
	}

	return (
		<div style={CONTENTS} {...attributes}>
			{props.children}
		</div>
	);
};
