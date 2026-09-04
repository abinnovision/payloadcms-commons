import { blockRowElementId } from "./element-id.js";

import type { FormStateLike } from "../resolve-path.js";

const BLOCK_TYPE_SUFFIX = ".blockType";
const COLLAPSIBLE = ".collapsible";
const BLOCK_HEADER = ".blocks-field__block-header";
const TOGGLE_WRAP = ".collapsible__toggle-wrap";

/**
 * The header element of the block row at `path`, when that row is currently
 * rendered. A collapsed row still renders its own header but none of its
 * contents, so nested rows appear and disappear as the editor expands things.
 *
 * Payload puts the row id on a bare wrapper whose only child is the
 * collapsible, so the row element is not itself `.collapsible`. Resolving that
 * child first is what keeps this from returning a nested row's header.
 */
const rowHeader = (doc: Document, path: string): HTMLElement | null => {
	const id = blockRowElementId(path);
	if (id === undefined) {
		return null;
	}

	const collapsible = doc
		.getElementById(id)
		?.querySelector<HTMLElement>(`:scope > ${COLLAPSIBLE}`);
	if (!collapsible) {
		return null;
	}

	for (const header of collapsible.querySelectorAll<HTMLElement>(
		BLOCK_HEADER,
	)) {
		if (header.closest(COLLAPSIBLE) === collapsible) {
			return header;
		}
	}

	return null;
};

/**
 * The slice of `Element` `rowHoverTarget` needs, so that resolving it can be
 * tested without a layout engine. Method syntax for the same reason as
 * `client/target.ts`: `strictFunctionTypes` would otherwise stop a real
 * `Element` from satisfying it.
 */
export interface RowHeaderElement {
	/* eslint-disable-next-line @typescript-eslint/method-signature-style -- see above */
	closest(selector: string): RowHeaderElement | null;
}

/**
 * The element that actually receives pointer events for a row header.
 *
 * Payload sets `pointer-events: none` on the wrap around the header so that
 * its collapse toggle, a button stretched over the whole strip, gets every
 * click. A listener on the header itself would therefore never fire. The
 * toggle wrap around it is the same visible strip and does receive them.
 */
export const rowHoverTarget = <TElement extends RowHeaderElement>(
	header: TElement,
): TElement => (header.closest(TOGGLE_WRAP) ?? header) as TElement;

/** Every block path the form knows about, whether rendered or not. */
export const blockPaths = (formState: FormStateLike): string[] =>
	Object.keys(formState)
		.filter((key) => key.endsWith(BLOCK_TYPE_SUFFIX))
		.map((key) => key.slice(0, -BLOCK_TYPE_SUFFIX.length))
		.sort();

/**
 * Maps each currently rendered block row to the header the locate button is
 * portalled into.
 */
export const findRowHeaders = (
	doc: Document,
	formState: FormStateLike,
): Map<string, HTMLElement> => {
	const headers = new Map<string, HTMLElement>();
	for (const path of blockPaths(formState)) {
		const header = rowHeader(doc, path);
		if (header) {
			headers.set(path, header);
		}
	}

	return headers;
};

/**
 * Whether two scans found the same rows in the same elements.
 *
 * Portalling the buttons mutates the DOM, which wakes the observer that
 * triggered the scan. Without this check that loop never settles.
 */
export const sameHeaders = <TElement>(
	a: ReadonlyMap<string, TElement>,
	b: ReadonlyMap<string, TElement>,
): boolean => {
	if (a.size !== b.size) {
		return false;
	}

	for (const [path, element] of a) {
		if (b.get(path) !== element) {
			return false;
		}
	}

	return true;
};
