import { blockRowElementId } from "./element-id.js";

import type { FormStateLike } from "../resolve-path.js";

const BLOCK_TYPE_SUFFIX = ".blockType";
const COLLAPSIBLE = ".collapsible";
const BLOCK_HEADER = ".blocks-field__block-header";

/** Every block path the form knows about, whether rendered or not. */
export const blockPaths = (formState: FormStateLike): string[] =>
	Object.keys(formState)
		.filter((key) => key.endsWith(BLOCK_TYPE_SUFFIX))
		.map((key) => key.slice(0, -BLOCK_TYPE_SUFFIX.length))
		.sort();

/**
 * Maps each currently rendered block row to its element.
 *
 * A collapsed row still renders its own header but none of its contents, so
 * the rows a form has and the rows it is showing are different sets, and this
 * is the second one.
 */
export const findRows = (
	doc: Document,
	formState: FormStateLike,
): Map<string, HTMLElement> => {
	const rows = new Map<string, HTMLElement>();
	for (const path of blockPaths(formState)) {
		const id = blockRowElementId(path);
		const row = id === undefined ? null : doc.getElementById(id);
		if (row) {
			rows.set(path, row);
		}
	}

	return rows;
};

/**
 * The header strip inside a row, which is where the locate button goes.
 *
 * Payload puts the row id on a bare wrapper whose only child is the
 * collapsible, so the row element is not itself `.collapsible`. Resolving
 * that child first is what keeps this from returning a nested row's header.
 */
export const rowHeader = (row: HTMLElement): HTMLElement | null => {
	const collapsible = row.querySelector<HTMLElement>(`:scope > ${COLLAPSIBLE}`);
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
 * The slice of `Element` the lookup below needs, so that it can be tested
 * without a layout engine.
 */
export interface RowNode {
	readonly parentElement: RowNode | null;
}

/**
 * The path of the innermost row containing `target`, if any.
 *
 * Walking up from the pointer's target is what makes the whole row hoverable
 * rather than just its header, and it resolves nesting for free: a hero
 * inside a section wrapper is found before the wrapper is, because it is
 * reached first.
 */
export const rowPathAt = <TNode extends RowNode>(
	rows: ReadonlyMap<TNode, string>,
	target: TNode | null,
): string | undefined => {
	for (let node = target; node !== null; node = node.parentElement as TNode) {
		const path = rows.get(node);
		if (path !== undefined) {
			return path;
		}
	}

	return undefined;
};

/**
 * Whether two scans found the same rows in the same elements.
 *
 * Portalling the buttons mutates the DOM, which wakes the observer that
 * triggered the scan. Without this check that loop never settles.
 */
export const sameRows = <TElement>(
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
