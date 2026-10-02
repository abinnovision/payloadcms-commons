/**
 * Client-side filter behind `TagsField`'s search box. The field loads every
 * tag once on mount rather than querying per keystroke, so filtering is a
 * pure, case-insensitive, whitespace-trimmed substring match.
 */
export const matchesTag = (label: string, input: string): boolean => {
	const needle = input.trim().toLowerCase();
	if (needle === "") {
		return true;
	}

	return label.toLowerCase().includes(needle);
};
