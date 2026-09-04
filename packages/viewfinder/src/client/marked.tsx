"use client";

import { markBlock } from "../attributes.js";

import type { ReactNode } from "react";

/**
 * `display: contents` removes the wrapper from layout entirely, so marking a
 * block cannot change how it renders. The cost is that the wrapper has no box
 * of its own; `measureElement` handles that.
 */
const CONTENTS = { display: "contents" } as const;

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
 * Blocks that already render a stable root element can spread `markBlock()`
 * onto it instead and skip this wrapper, which gives the overlay a real box
 * to measure rather than an inferred one.
 */
export const Marked = (props: MarkedProps): ReactNode => {
	if (props.enabled === false || props.id.length === 0) {
		return props.children;
	}

	return (
		<div style={CONTENTS} {...markBlock(props.id, props.blockType)}>
			{props.children}
		</div>
	);
};
