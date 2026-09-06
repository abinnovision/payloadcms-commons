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
 * Attributes identifying one block in the rendered output. Spread onto the
 * block's own root element, and only when the page is a preview: an address
 * is a preview affordance, not something a visitor's markup needs.
 *
 * A block with no root element of its own has to grow one to be addressable.
 * That element is worth adding deliberately, since a real element has a real
 * box and the highlight overlay measures it directly.
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
