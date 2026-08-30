import { allowedNodeTypes, nodeOptions } from "./lexical.js";
import { isPlainObject } from "./walk.js";

import type { NodeOptions } from "./lexical.js";
import type { RichTextField } from "payload";

/**
 * One node in a rich text field's editor state, positioned so it can be
 * patched without re-reading the whole field first.
 */
export interface LexicalOutlineEntry {
	children?: number;
	/** Narrowed properties actually set, e.g. { tag: "h2" }. */
	options?: Record<string, string>;
	pointer: string;
	/** Concatenated descendant text, truncated. Absent where there is none. */
	text?: string;
	type: string;
	/** So an add can copy it from a sibling instead of guessing. */
	version?: number;
}

/**
 * Long enough to identify a paragraph, short enough that an outline of a real
 * document stays a fraction of the size of its editor state.
 */
const TEXT_PREVIEW_LENGTH = 80;

/**
 * Every descendant text node contributes, not only direct children, since a
 * link or a formatting mark nests the text a level deeper.
 */
const collectText = (node: Record<string, unknown>): string => {
	if (node["type"] === "text") {
		return typeof node["text"] === "string" ? node["text"] : "";
	}

	const children = node["children"];

	return Array.isArray(children)
		? children
				.filter(isPlainObject)
				.map((child) => collectText(child))
				.join("")
		: "";
};

const preview = (text: string): string =>
	text.length > TEXT_PREVIEW_LENGTH
		? `${text.slice(0, TEXT_PREVIEW_LENGTH)}…`
		: text;

/**
 * Only the properties a feature actually narrows for this node type, and only
 * where the node carries a string for one. A node missing the property, or
 * carrying something the feature never produces, says nothing worth reporting.
 */
const narrowedOptions = (
	node: Record<string, unknown>,
	narrowed: Record<string, string[]> | undefined,
): Record<string, string> | undefined => {
	if (!narrowed) {
		return undefined;
	}

	const set = Object.keys(narrowed).flatMap((property) => {
		const value = node[property];

		return typeof value === "string" ? [[property, value] as const] : [];
	});

	return set.length > 0 ? Object.fromEntries(set) : undefined;
};

const walk = (
	node: Record<string, unknown>,
	pointer: string,
	options: NodeOptions | undefined,
	entries: LexicalOutlineEntry[],
): void => {
	const type = node["type"];

	/* A node written before the shape check landed may carry none. */
	if (typeof type !== "string") {
		return;
	}

	const version = node["version"];
	const text = preview(collectText(node));
	const nodeOptionsFound = narrowedOptions(node, options?.[type]);
	const children = node["children"];
	const childCount = Array.isArray(children) ? children.length : 0;

	entries.push({
		...(childCount === 0 ? {} : { children: childCount }),
		...(nodeOptionsFound === undefined ? {} : { options: nodeOptionsFound }),
		pointer,
		...(text === "" ? {} : { text }),
		type,
		...(typeof version === "number" ? { version } : {}),
	});

	if (Array.isArray(children)) {
		children.forEach((child, index) => {
			if (isPlainObject(child)) {
				walk(child, `${pointer}/children/${String(index)}`, options, entries);
			}
		});
	}
};

/**
 * A depth-first listing of every node under an editor state's root, so an
 * agent can find a position and a sibling's `version` without reading the
 * whole state. `basePointer` is the field's own pointer, e.g. "/content"; each
 * entry's `pointer` extends it with "/root" and the node's real indices, which
 * makes it directly usable in a patch operation.
 */
export const lexicalOutline = (
	state: unknown,
	basePointer: string,
	field: RichTextField,
): LexicalOutlineEntry[] => {
	if (!isPlainObject(state)) {
		return [];
	}

	const root = state["root"];

	if (!isPlainObject(root) || !Array.isArray(root["children"])) {
		return [];
	}

	const options = nodeOptions(field, allowedNodeTypes(field));
	const entries: LexicalOutlineEntry[] = [];

	root["children"].forEach((child, index) => {
		if (isPlainObject(child)) {
			walk(
				child,
				`${basePointer}/root/children/${String(index)}`,
				options,
				entries,
			);
		}
	});

	return entries;
};
