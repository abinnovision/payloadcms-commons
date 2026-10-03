/*
 * Lexical nodes as the editor serializes them, so a case leaves out only the
 * property it is about.
 */

export const text = (value = "hi") => ({
	detail: 0,
	format: 0,
	mode: "normal",
	style: "",
	text: value,
	type: "text",
	version: 1,
});

export const node = (
	type: string,
	extra: Record<string, unknown> = {},
	children: unknown[] = [],
) => ({
	children,
	direction: "ltr",
	format: "",
	indent: 0,
	type,
	version: 1,
	...extra,
});

export const state = (children: unknown[]) => ({
	root: {
		children,
		direction: "ltr",
		format: "",
		indent: 0,
		type: "root",
		version: 1,
	},
});

/** An editor state holding one paragraph of `value`. */
export const paragraph = (value: string) =>
	state([node("paragraph", {}, [text(value)])]);

/**
 * A bulleted list with one item. `stripIndent` leaves out the item's indent, as
 * a client trimming boilerplate would, and `indent` puts something else there.
 * Payload stores either, and the admin editor throws opening it.
 */
export const bulletList = (
	value: string,
	options: { indent?: unknown; stripIndent?: boolean } = {},
) => {
	const item: Record<string, unknown> = node(
		"listitem",
		{
			checked: false,
			indent: "indent" in options ? options.indent : 0,
			value: 1,
		},
		[text(value)],
	);

	if (options.stripIndent === true) {
		delete item["indent"];
	}

	return state([
		node("list", { listType: "bullet", start: 1, tag: "ul" }, [item]),
	]);
};
