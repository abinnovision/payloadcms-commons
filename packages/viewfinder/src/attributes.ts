/**
 * The rendered page carries no field paths. It carries the Payload row `id`
 * that every block already has, and the admin resolves that back to a path
 * against its own form state. That is what keeps the frontend free of a
 * content source map and the API unchanged.
 */
export const BLOCK_ID_ATTRIBUTE = "data-vf-id";

/** Advisory only: the admin addresses blocks by id, never by type. */
export const BLOCK_TYPE_ATTRIBUTE = "data-vf-type";

/** Resolved against the nearest marked block ancestor, so it stays index-free. */
export const FIELD_ATTRIBUTE = "data-vf-field";

export interface BlockMarkerAttributes {
	readonly [BLOCK_ID_ATTRIBUTE]: string;
	readonly [BLOCK_TYPE_ATTRIBUTE]?: string;
}

export interface FieldMarkerAttributes {
	readonly [FIELD_ATTRIBUTE]: string;
}

/**
 * Attributes identifying one block in the rendered output. Spread onto a
 * block's own root element to skip the `<Marked>` wrapper, which is worth
 * doing wherever the block already renders a stable element: a real element
 * has a real box, so the highlight overlay does not have to infer geometry
 * from children.
 */
export const markBlock = (
	id: string,
	blockType?: string,
): BlockMarkerAttributes =>
	blockType === undefined
		? { [BLOCK_ID_ATTRIBUTE]: id }
		: { [BLOCK_ID_ATTRIBUTE]: id, [BLOCK_TYPE_ATTRIBUTE]: blockType };

/**
 * Attributes identifying one field within the enclosing block. `field` is
 * relative to that block (`"heading"`, or `"items.0.label"` for something
 * nested), never an absolute document path.
 */
export const markField = (field: string): FieldMarkerAttributes => ({
	[FIELD_ATTRIBUTE]: field,
});
