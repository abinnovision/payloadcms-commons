import { lexicalSubSchema, subSchemaNodeTypes } from "./lexical.js";
import {
	blockOf,
	blockSlugsOf,
	isIndexSegment,
	isPlainObject,
	joinPath,
} from "./walk.js";

import type { FieldDescriptor } from "./walk.js";
import type { FlattenedField, RichTextField, SanitizedConfig } from "payload";

/**
 * A position inside a Lexical editor state.
 *
 * `descriptor` is the rich text field's own descriptor rather than anything
 * synthesised for the node, so the editor's node list and the field's
 * read-only flag travel with every position inside it.
 */
interface LexicalPositionBase {
	descriptor: FieldDescriptor;
	field: RichTextField;
	/** The root is addressable, and refused as a write, so it is marked here. */
	isRoot?: boolean;
	/**
	 * The node in scope. Absent only at a position the state does not have and
	 * the value being added did not name.
	 */
	nodeType?: string;
}

export type LexicalPosition =
	/** …/children/2, or …/root. */
	| (LexicalPositionBase & { kind: "node" })
	/** …/children, the list a node owns. */
	| (LexicalPositionBase & { kind: "nodes" })
	/** …/children/2/tag, where the node and the property are both known. */
	| (LexicalPositionBase & {
			kind: "property";
			nodeType: string;
			property: string;
	  });

/**
 * Either the pointer ends inside the state, or it reaches a node's `fields`,
 * where ordinary Payload fields resume and the caller's walk takes over again.
 */
type LexicalStep =
	| { kind: "position"; position: LexicalPosition }
	| {
			blockType?: string;
			data: unknown;
			fields: FlattenedField[];
			kind: "fields";
			rest: string[];
	  };

/**
 * A node's `fields` is ordinary Payload field-land, reached either through the
 * schema a feature declares for the node or, where the node picks a block by
 * slug, through that block.
 */
const stepIntoFields = (at: {
	addedValue: unknown;
	config: SanitizedConfig;
	field: RichTextField;
	node: Record<string, unknown> | undefined;
	nodeType: string;
	rest: string[];
}): LexicalStep => {
	const { addedValue, config, field, node, nodeType, rest } = at;
	const sub = lexicalSubSchema(field, nodeType);

	if (!sub) {
		throw new Error(
			`"${nodeType}" nodes carry no addressable fields in this field's editor. Node types with fields here: ${subSchemaNodeTypes(field).join(", ")}`,
		);
	}

	const data = node?.["fields"];

	if (sub.kind === "fields") {
		return { data, fields: sub.fields, kind: "fields", rest };
	}

	const added = (addedValue as { fields?: unknown } | undefined)?.fields;
	const slug =
		(isPlainObject(data) ? data["blockType"] : undefined) ??
		(isPlainObject(added) ? added["blockType"] : undefined);

	if (typeof slug !== "string") {
		throw new Error(
			`Cannot tell which block a "${nodeType}" node holds. Supply a "blockType" on the value, one of: ${blockSlugsOf(sub.blocksField).join(", ")}`,
		);
	}

	const block = blockOf(config, sub.blocksField, slug);

	if (!block) {
		throw new Error(
			`"${slug}" is not allowed in a "${nodeType}" node here. Allowed: ${blockSlugsOf(sub.blocksField).join(", ")}`,
		);
	}

	return {
		blockType: slug,
		data,
		fields: block.flattenedFields,
		kind: "fields",
		rest,
	};
};

/**
 * Walks the segments left over once a pointer has reached a rich text field.
 *
 * The stored state chooses the branch at every index, exactly as the stored
 * document chooses it at a blocks element: an editor state admits many node
 * shapes at the same position, and only what is there says which one it is.
 * A position the document does not have yet takes its type from the value
 * being added, and is addressable no further.
 */
export const resolveLexicalPointer = (at: {
	addedValue?: unknown;
	config: SanitizedConfig;
	descriptor: FieldDescriptor;
	field: RichTextField;
	segments: readonly string[];
	state: unknown;
}): LexicalStep => {
	const { addedValue, config, descriptor, field, state } = at;
	const base = { descriptor, field };

	if (!isPlainObject(state) || !isPlainObject(state["root"])) {
		throw new Error(
			`"${descriptor.path}" holds no editor state yet. Write the whole field once, then address positions inside it.`,
		);
	}

	const [entry, ...rest] = at.segments;

	if (entry !== "root") {
		throw new Error(
			`"${String(entry)}" is not a position in a rich text field. An editor state is entered at "root", e.g. "${descriptor.path}/root/children/0".`,
		);
	}

	let node: Record<string, unknown> | undefined = state["root"];
	let nodeType = "root";
	let segments: string[] = rest;
	/* Reported back to the client, so it is built the way the client wrote it. */
	let walked: string[] = ["root"];

	for (;;) {
		if (segments.length === 0) {
			return {
				kind: "position",
				position: {
					...base,
					...(nodeType === "root" ? { isRoot: true } : {}),
					kind: "node",
					nodeType,
				},
			};
		}

		const [segment, ...remaining] = segments as [string, ...string[]];

		if (segment === "children") {
			if (remaining.length === 0) {
				return {
					kind: "position",
					position: {
						...base,
						...(nodeType === "root" ? { isRoot: true } : {}),
						kind: "nodes",
						nodeType,
					},
				};
			}

			const [index, ...beyond] = remaining as [string, ...string[]];

			if (!isIndexSegment(index)) {
				throw new Error(
					`"${descriptor.path}${joinPath([...walked, "children"])}" is a list; "${index}" is not an index.`,
				);
			}

			const children: unknown = node?.["children"];
			const child: unknown =
				Array.isArray(children) && index !== "-"
					? children[Number(index)]
					: undefined;

			const type = isPlainObject(child)
				? child["type"]
				: (addedValue as { type?: unknown } | undefined)?.type;

			if (typeof type !== "string") {
				if (beyond.length === 0) {
					return {
						kind: "position",
						position: { ...base, kind: "node" },
					};
				}

				throw new Error(
					`Cannot tell which node "${descriptor.path}${joinPath([...walked, "children", index])}" is. Read the document first, or address an existing position.`,
				);
			}

			node = isPlainObject(child) ? child : undefined;
			nodeType = type;
			segments = beyond;
			walked = [...walked, "children", index];

			continue;
		}

		if (segment === "fields") {
			return stepIntoFields({
				addedValue,
				config,
				field,
				node,
				nodeType,
				rest: remaining,
			});
		}

		if (remaining.length > 0) {
			throw new Error(
				`"${segment}" is a property of a "${nodeType}" node and nothing beneath it can be addressed.`,
			);
		}

		return {
			kind: "position",
			position: {
				...base,
				...(nodeType === "root" ? { isRoot: true } : {}),
				kind: "property",
				nodeType,
				property: segment,
			},
		};
	}
};
