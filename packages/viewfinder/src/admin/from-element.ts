import { resolveAddressForPath } from "../resolve-path.js";
import { blockRowElementId } from "./element-id.js";

import type { BlockAddress, FormStateLike } from "../index.js";

/**
 * The slice of `Element` needed to walk up the admin form. Kept narrow so the
 * decision logic is testable without rendering Payload's admin.
 */
export interface AncestorElement {
	readonly id: string;
	readonly parentElement: AncestorElement | null;
}

const FIELD_PREFIX = "field-";
const BLOCK_TYPE_SUFFIX = ".blockType";

/** Inverse of `fieldElementId`. */
const pathFromFieldId = (id: string): string =>
	id.slice(FIELD_PREFIX.length).split("__").join(".");

/**
 * Row ids join path segments with `-`, which a slug containing a dash makes
 * ambiguous to parse. So candidates are generated from form state, which is
 * authoritative, and matched by equality instead.
 */
const rowPathsById = (formState: FormStateLike): Map<string, string> => {
	const byId = new Map<string, string>();
	for (const key of Object.keys(formState)) {
		if (!key.endsWith(BLOCK_TYPE_SUFFIX)) {
			continue;
		}

		const path = key.slice(0, -BLOCK_TYPE_SUFFIX.length);
		const rowId = blockRowElementId(path);
		if (rowId !== undefined) {
			byId.set(rowId, path);
		}
	}

	return byId;
};

/**
 * Resolves the block address for whatever the editor just touched in the
 * admin form.
 *
 * Walks ancestors once and takes the first hit, so the nearest of "a field"
 * and "a block row" wins. Checking fields first instead would report the
 * enclosing blocks field for a click on a row header, which is not a block.
 */
export const resolveAddressForElement = (
	formState: FormStateLike,
	element: AncestorElement | null,
): BlockAddress | undefined => {
	const rowPaths = rowPathsById(formState);

	for (let node = element; node !== null; node = node.parentElement) {
		if (node.id.startsWith(FIELD_PREFIX)) {
			return resolveAddressForPath(formState, pathFromFieldId(node.id));
		}

		const rowPath = rowPaths.get(node.id);
		if (rowPath !== undefined) {
			return resolveAddressForPath(formState, rowPath);
		}
	}

	return undefined;
};
