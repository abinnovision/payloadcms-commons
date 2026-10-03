import { SchemaError } from "./errors.js";
import { lexicalSubSchema, subSchemaNodeTypes } from "./lexical.js";
import { isIndexSegment, joinPath } from "./path.js";
import { blockOf, blockSlugsOf } from "./walk.js";
import { isPlainObject } from "../guards.js";

import type { FieldDescriptor } from "./walk.js";
import type { FlattenedField, RichTextField, SanitizedConfig } from "payload";

/*
 * A position inside a Lexical editor state. `descriptor` is the rich text
 * field's own descriptor, not one synthesised for the node, so the editor's
 * node list and the field's read-only flag apply to every position inside it.
 */
interface LexicalPositionBase {
	descriptor: FieldDescriptor;
	field: RichTextField;
	/**
	 * The root is addressable, and refused as a write, so it is marked here.
	 */
	isRoot?: boolean;
	/**
	 * The node in scope. Absent only at a position the state does not have and
	 * the value being added did not name.
	 */
	nodeType?: string;
}

export type LexicalPosition =
	/**
	 * …/children/2, or …/root.
	 */
	| (LexicalPositionBase & { kind: "node" })
	/**
	 * …/children, the list a node owns.
	 */
	| (LexicalPositionBase & { kind: "nodes" })
	/**
	 * …/children/2/tag, where the node and the property are both known.
	 */
	| (LexicalPositionBase & {
			kind: "property";
			nodeType: string;
			property: string;
	  });

/*
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

/*
 * A node's `fields` are ordinary Payload fields, reached through the schema a
 * feature declares for the node or, where the node picks a block by slug,
 * through that block.
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
		throw new SchemaError(
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

	if (slug === undefined) {
		throw new SchemaError(
			`Cannot tell which block a "${nodeType}" node holds. Supply a "blockType" on the value, one of: ${blockSlugsOf(sub.blocksField).join(", ")}`,
		);
	}

	if (typeof slug !== "string") {
		throw new SchemaError(
			`"blockType" must be a string naming a block in a "${nodeType}" node here. Allowed: ${blockSlugsOf(sub.blocksField).join(", ")}`,
		);
	}

	const block = blockOf(config, sub.blocksField, slug);

	if (!block) {
		throw new SchemaError(
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
 * The stored state chooses the branch at every index, as the stored document
 * does at a blocks element: an editor state admits many node shapes at the same
 * position. A position the document does not have yet takes its type from the
 * value being added and is addressable no further.
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
		throw new SchemaError(
			`"${descriptor.path}" holds no editor state yet. Write the whole field once, then address positions inside it.`,
		);
	}

	const [entry, ...rest] = at.segments;

	if (entry !== "root") {
		throw new SchemaError(
			`"${String(entry)}" is not a position in a rich text field. An editor state is entered at "root", e.g. "${descriptor.path}/root/children/0". getDocument with "outline" lists every position this field holds.`,
		);
	}

	let node: Record<string, unknown> | undefined = state["root"];
	let nodeType = "root";
	let segments: string[] = rest;
	// Reported back to the client, so it is built the way the client wrote it.
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
				throw new SchemaError(
					`"${descriptor.path}${joinPath([...walked, "children"])}" is a list; "${index}" is not an index. getDocument with "outline" reports the pointer of each node in it.`,
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

				throw new SchemaError(
					`Cannot tell which node "${descriptor.path}${joinPath([...walked, "children", index])}" is. Call getDocument with "outline" for the pointer of each node, or address an existing position.`,
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
			throw new SchemaError(
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
