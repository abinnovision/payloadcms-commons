import type { BlockAddress } from "./protocol.js";

/**
 * The single place this package assumes anything about Payload internals.
 *
 * Payload's admin form state is already flat-keyed by field path — a block
 * three levels deep appears as discrete `layout.0.modules.2.heading` entries,
 * not as a nested document. That is what makes id lookup a scan rather than a
 * tree walk, and it is why nothing here needs to reconstruct the document or
 * know the collection's schema. If a Payload upgrade changes the key shape,
 * this file is the only one that has to move.
 */
export type FormStateLike = Readonly<
	Record<string, { value?: unknown } | undefined>
>;

const ID_SUFFIX = ".id";
const BLOCK_TYPE_SUFFIX = ".blockType";

/**
 * The document's own `id` lives at the bare key `"id"`, which has no dot and
 * so is never a candidate. Every other `*.id` is a block row or an array row.
 */
const isRowIdKey = (key: string): boolean => key.endsWith(ID_SUFFIX);

/**
 * Resolves a Payload row `id` to its form path (`layout.0.modules.2`).
 *
 * Ids are unique in practice; if two rows somehow carry the same one, the
 * shallowest path wins so the result stays deterministic rather than
 * depending on key order.
 */
export const resolveBlockPath = (
	formState: FormStateLike,
	id: string,
): string | undefined => {
	let best: string | undefined;

	for (const key of Object.keys(formState)) {
		if (!isRowIdKey(key) || formState[key]?.value !== id) {
			continue;
		}

		const path = key.slice(0, -ID_SUFFIX.length);
		if (best === undefined || path.length < best.length) {
			best = path;
		}
	}

	return best;
};

/** Joins a block path and a block-relative field name into a form path. */
export const resolveFieldPath = (blockPath: string, field: string): string =>
	`${blockPath}.${field}`;

/**
 * Resolves a whole address to the form path the admin should reveal: the
 * block itself, or a field inside it when the preview named one.
 */
export const resolveAddressPath = (
	formState: FormStateLike,
	address: BlockAddress,
): string | undefined => {
	const blockPath = resolveBlockPath(formState, address.id);
	if (blockPath === undefined || address.field === undefined) {
		return blockPath;
	}

	return resolveFieldPath(blockPath, address.field);
};

/**
 * The inverse, for the admin-to-preview direction: given any form path, finds
 * the id of the nearest enclosing block.
 *
 * Walks ancestors deepest-first and requires a sibling `blockType`, which is
 * what distinguishes a block row from a plain array row — array rows also
 * carry an `id`, but the preview knows nothing about them.
 */
export const resolveBlockIdForPath = (
	formState: FormStateLike,
	path: string,
): string | undefined => {
	const segments = path.split(".");

	for (let end = segments.length; end > 0; end--) {
		const prefix = segments.slice(0, end).join(".");
		if (formState[`${prefix}${BLOCK_TYPE_SUFFIX}`] === undefined) {
			continue;
		}

		const id = formState[`${prefix}${ID_SUFFIX}`]?.value;
		if (typeof id === "string" && id.length > 0) {
			return id;
		}
	}

	return undefined;
};

/**
 * The address to send into the preview for a form path, carrying the field
 * suffix when the path pointed inside a block rather than at it.
 */
export const resolveAddressForPath = (
	formState: FormStateLike,
	path: string,
): BlockAddress | undefined => {
	const id = resolveBlockIdForPath(formState, path);
	if (id === undefined) {
		return undefined;
	}

	const blockPath = resolveBlockPath(formState, id);
	const blockType =
		formState[`${blockPath ?? path}${BLOCK_TYPE_SUFFIX}`]?.value;

	return {
		id,
		/*
		 * Carried so the preview overlay can label the block, which is what
		 * makes the two directions look the same to an editor.
		 */
		...(typeof blockType === "string" ? { blockType } : {}),
		...(blockPath === undefined || blockPath === path
			? {}
			: { field: path.slice(blockPath.length + 1) }),
	};
};
