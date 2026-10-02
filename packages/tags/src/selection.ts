/**
 * One tag as `TagsField` knows it: an id it can reuse and the title it was
 * created with.
 */
export interface TagOption {
	id: string | number;
	label: string;
	/** ISO timestamp, absent for an option created earlier in the same session. */
	createdAt?: string;
}

/**
 * What `onChange` receives from `react-select`'s creatable branch: an
 * existing option, or a freshly typed one flagged with `__isNew__`.
 */
export interface SelectionInput {
	__isNew__?: boolean;
	id?: string | number;
	label: string;
}

export type SelectionResult =
	| { type: "empty" }
	| { type: "reuse"; id: string | number }
	| { type: "create"; label: string };

/**
 * Decides what typing Enter on a tag should do: reuse an existing tag,
 * create a new one, or do nothing. Kept pure so the field component only has
 * to act on the result, POSTing a create or reusing an id.
 *
 * An untrimmed or differently-cased match still resolves to `reuse`, which is
 * what makes the 400-duplicate response from the server a fallback rather
 * than the primary path: this covers the common case client-side, the loose
 * `like` pre-filter server-side covers what a stale local list missed.
 */
export const resolveSelection = (
	input: SelectionInput,
	existing: readonly TagOption[],
): SelectionResult => {
	const trimmed = input.label.trim();
	if (trimmed === "") {
		return { type: "empty" };
	}

	if (input.__isNew__ !== true && input.id !== undefined) {
		return { type: "reuse", id: input.id };
	}

	const needle = trimmed.toLowerCase();
	const matches = existing.filter(
		(option) => option.label.trim().toLowerCase() === needle,
	);

	if (matches.length === 0) {
		return { type: "create", label: trimmed };
	}

	/*
	 * Oldest wins on ties, so repeatedly reusing a mixed-case duplicate always
	 * converges on the same tag instead of drifting between equally-valid ones.
	 */
	const oldest = matches.reduce((first, candidate) => {
		if (first.createdAt === undefined) {
			return first;
		}

		if (candidate.createdAt === undefined) {
			return candidate;
		}

		return candidate.createdAt < first.createdAt ? candidate : first;
	});

	return { type: "reuse", id: oldest.id };
};
