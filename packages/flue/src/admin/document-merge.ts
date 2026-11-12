import { isRecord } from "../protocol/guards.js";

/** The part of a Payload form field's state the merge reads. */
export interface FieldEntry {
	value?: unknown;
	initialValue?: unknown;
	/** Set on array and blocks fields, one entry per row. */
	rows?: readonly { id: string }[];
}

/** A user's unsaved value, kept across a reload. */
export interface DirtyField {
	path: string;
	value: unknown;
}

/**
 * What a reload does with a modified form: reset it and apply the user's
 * values again, or leave it alone because rows moved and paths no longer
 * line up. `conflicts` lists the paths the agent changed as well.
 */
export type MergePlan =
	| { kind: "merge"; dirty: DirtyField[]; conflicts: string[] }
	| { kind: "stale" };

/** Whether two JSON values are equal. */
export const isEqual = (a: unknown, b: unknown): boolean => {
	if (Object.is(a, b)) {
		return true;
	}

	if (Array.isArray(a) && Array.isArray(b)) {
		return a.length === b.length && a.every((item, i) => isEqual(item, b[i]));
	}

	if (isRecord(a) && isRecord(b) && !Array.isArray(a) && !Array.isArray(b)) {
		const keys = Object.keys(a);

		return (
			keys.length === Object.keys(b).length &&
			keys.every((key) => Object.hasOwn(b, key) && isEqual(a[key], b[key]))
		);
	}

	return false;
};

/** The value at a dotted form path in document data, through rows too. */
export const valueAt = (data: unknown, path: string): unknown =>
	path.split(".").reduce<unknown>((current, key) => {
		if (Array.isArray(current)) {
			return current[Number(key)];
		}

		return isRecord(current) ? current[key] : undefined;
	}, data);

// The row ids of an array or blocks value in document data.
const rowIdsAt = (data: unknown, path: string): string[] => {
	const rows = valueAt(data, path);

	return Array.isArray(rows)
		? rows.map((row) =>
				isRecord(row) && typeof row["id"] === "string" ? row["id"] : "",
			)
		: [];
};

const isRowMetadata = (path: string): boolean =>
	path === "id" || path.endsWith(".id") || path.endsWith(".blockType");

/**
 * The leaf fields whose value differs from the value the form loaded. Array
 * and blocks fields, and the ids and block types of their rows, are left out.
 */
export const dirtyFields = (
	fields: Readonly<Record<string, FieldEntry>>,
): DirtyField[] =>
	Object.entries(fields)
		.filter(
			([path, field]) =>
				field.rows === undefined &&
				!isRowMetadata(path) &&
				!isEqual(field.value, field.initialValue),
		)
		.map(([path, field]) => ({ path, value: field.value }));

/**
 * The array and blocks fields whose rows differ, by count or id, between the
 * form and `data`, the document the form was loaded from.
 */
export const changedRows = (
	fields: Readonly<Record<string, FieldEntry>>,
	data: unknown,
): string[] =>
	Object.entries(fields)
		.filter(
			([path, field]) =>
				field.rows !== undefined &&
				!isEqual(
					field.rows.map((row) => row.id),
					rowIdsAt(data, path),
				),
		)
		.map(([path]) => path);

/** The dirty paths the agent changed too: `server` differs from what the form loaded. */
export const conflictingPaths = (
	fields: Readonly<Record<string, FieldEntry>>,
	dirty: readonly DirtyField[],
	server: unknown,
): string[] =>
	dirty
		.filter(
			({ path }) => !isEqual(valueAt(server, path), fields[path]?.initialValue),
		)
		.map(({ path }) => path);

/**
 * How to bring the agent's document into a modified form. Rows the user
 * added, removed or moved, or rows the agent changed around one of the
 * user's values, make the user's paths unreliable, so the form goes stale.
 */
export const mergePlan = (
	fields: Readonly<Record<string, FieldEntry>>,
	loaded: unknown,
	server: unknown,
): MergePlan => {
	const dirty = dirtyFields(fields);
	const agentRows = Object.keys(fields).filter(
		(path) =>
			fields[path]?.rows !== undefined &&
			!isEqual(rowIdsAt(server, path), rowIdsAt(loaded, path)),
	);

	if (
		changedRows(fields, loaded).length > 0 ||
		dirty.some(({ path }) =>
			agentRows.some((rows) => path.startsWith(`${rows}.`)),
		)
	) {
		return { kind: "stale" };
	}

	return {
		kind: "merge",
		dirty,
		conflicts: conflictingPaths(fields, dirty, server),
	};
};
