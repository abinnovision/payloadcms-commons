import { COLOR_FIELD, TITLE_FIELD } from "./options.js";

/**
 * One tag as it reaches a list cell: either the bare relationship id (depth 0,
 * or a document the read access denied) or the populated document.
 */
export type CellRelationshipValue =
	string | number | { [key: string]: unknown; id: string | number };

export interface CellTag {
	id: string | number;
	label: string;
	color: string | null;
	/** False for a bare id: unreadable, deleted, or never populated. */
	readable: boolean;
}

export interface NormalizedCell {
	visible: CellTag[];
	overflow: number;
}

/** How many pills a cell shows before collapsing the rest into "+N". */
const VISIBLE_LIMIT = 3;

/** A tag's display label: its title, or a `#id` fallback when it has none. */
export const tagLabel = (title: unknown, id: string | number): string =>
	typeof title === "string" && title !== "" ? title : `#${String(id)}`;

/**
 * Normalizes a populated tag document into the shape the admin components
 * render, reading the title and color by the fields the plugin generates.
 */
export const toTag = (doc: {
	[key: string]: unknown;
	id: string | number;
}): CellTag => {
	const color = doc[COLOR_FIELD];

	return {
		id: doc.id,
		label: tagLabel(doc[TITLE_FIELD], doc.id),
		color: typeof color === "string" ? color : null,
		readable: true,
	};
};

/**
 * Splits a relationship's value into the pills a cell renders directly and
 * the count folded into a trailing "+N", mirroring Payload's own
 * `DefaultCell` relationship pattern.
 */
export const normalizeCellValues = (
	values: readonly CellRelationshipValue[] | null | undefined,
): NormalizedCell => {
	const tags = (values ?? []).map((value) =>
		typeof value === "string" || typeof value === "number"
			? { id: value, label: `#${String(value)}`, color: null, readable: false }
			: toTag(value),
	);

	return {
		visible: tags.slice(0, VISIBLE_LIMIT),
		overflow: Math.max(0, tags.length - VISIBLE_LIMIT),
	};
};
