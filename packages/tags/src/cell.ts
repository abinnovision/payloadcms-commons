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

const toTag = (value: CellRelationshipValue, titleField: string): CellTag => {
	if (typeof value === "string" || typeof value === "number") {
		return {
			id: value,
			label: `#${String(value)}`,
			color: null,
			readable: false,
		};
	}

	const title = value[titleField];
	const color = value["color"];

	return {
		id: value.id,
		label:
			typeof title === "string" && title !== ""
				? title
				: `#${String(value.id)}`,
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
	titleField: string,
): NormalizedCell => {
	const tags = (values ?? []).map((value) => toTag(value, titleField));

	return {
		visible: tags.slice(0, VISIBLE_LIMIT),
		overflow: Math.max(0, tags.length - VISIBLE_LIMIT),
	};
};
