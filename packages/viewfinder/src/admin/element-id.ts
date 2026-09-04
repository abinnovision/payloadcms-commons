/**
 * The second place this package leans on Payload internals, kept separate
 * from `resolve-path.ts` because these are DOM conventions of the admin
 * bundle rather than form-state conventions.
 *
 * Payload renders a field wrapper as `id="field-<path with dots as __>"`
 * (every module under `@payloadcms/ui/fields`) and a block row as
 * `id="<parent path with dots as ->-row-<index>"` (`fields/Blocks/BlockRow`).
 */
const FIELD_PREFIX = "field-";

/** DOM id of the wrapper Payload renders for a field path. */
export const fieldElementId = (path: string): string =>
	`${FIELD_PREFIX}${path.split(".").join("__")}`;

/**
 * DOM id of the block row at a path, or undefined for a path that is not
 * shaped like a row (no trailing numeric index).
 */
export const blockRowElementId = (path: string): string | undefined => {
	const segments = path.split(".");
	const index = segments.pop();
	if (index === undefined || !/^\d+$/.test(index) || segments.length === 0) {
		return undefined;
	}

	return `${segments.join("-")}-row-${index}`;
};

/**
 * The DOM ids worth trying for a resolved path, most specific first.
 *
 * A block path resolves to a row, but a field path inside it resolves to the
 * field wrapper — and a field that is itself a blocks or array field has
 * both. Callers take the first that exists.
 */
export const candidateElementIds = (path: string): string[] => {
	const row = blockRowElementId(path);

	return row === undefined
		? [fieldElementId(path)]
		: [row, fieldElementId(path)];
};

/**
 * The block-row paths along a form path, outermost first.
 *
 * `layout.1.modules.0.title` yields `["layout.1", "layout.1.modules.0"]`: a
 * row is any prefix ending in an index. Used to expand a path's ancestors in
 * order, since a collapsed row renders none of its contents and the deeper
 * rows therefore do not exist yet.
 */
export const rowPathsAlong = (path: string): string[] => {
	const segments = path.split(".");
	const paths: string[] = [];

	for (let end = 1; end <= segments.length; end++) {
		const last = segments[end - 1];
		if (last !== undefined && /^\d+$/.test(last) && end > 1) {
			paths.push(segments.slice(0, end).join("."));
		}
	}

	return paths;
};
