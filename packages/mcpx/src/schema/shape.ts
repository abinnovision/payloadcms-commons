import {
	constrainsFields,
	lexicalSubSchema,
	nodeProblems,
	propertyProblem,
	rootProblems,
	ROOT_PROPERTIES,
} from "./lexical.js";
import {
	ARRAY_MARKER,
	blockOf,
	blockSlugsOf,
	describeAddressableFields,
	findBlocksField,
	findRichTextField,
	isPlainObject,
	splitPath,
} from "./walk.js";

import type { LexicalPosition } from "./lexical-pointer.js";
import type { NodeOptions } from "./lexical.js";
import type { PointerResolution } from "./pointer.js";
import type { FieldDescriptor } from "./walk.js";
import type { FlattenedField, RichTextField, SanitizedConfig } from "payload";

const TOLERATED_VALUE_KEYS = new Set(["blockName", "blockType", "id"]);

/**
 * Lexical refuses to hydrate a state whose root holds nothing: `isEmpty` is a
 * node map of one, and the editor throws on it rather than rendering nothing.
 * An empty field is stored as null instead, so this is only ever reached by
 * emptying one that was there.
 */
export const EMPTY_ROOT =
	"an editor state needs at least one node. Clear the field with null instead.";

const quoted = (properties: readonly string[]): string =>
	properties.map((property) => `"${property}"`).join(", ");

/**
 * A position in an incoming value, and where the problems go.
 *
 * `pointer` is the address of the value in the document, reported back to the
 * client. `prefix` is where the value sits inside `fields`, held as segments
 * because nothing outside this walk reads it.
 */
interface CheckScope {
	config: SanitizedConfig;
	fields: FlattenedField[];
	pointer: string;
	prefix: readonly string[];
	problems: string[];
}

/**
 * A node with nothing to declare, and one whose sub-fields cannot be named at a
 * position, are both left alone.
 */
const checkNodeFields = (
	scope: CheckScope,
	field: RichTextField,
	node: { fields: unknown; type: string },
): void => {
	const sub = lexicalSubSchema(field, node.type);

	if (!sub) {
		return;
	}

	const data = node.fields;

	if (!isPlainObject(data)) {
		/* Reported already, and more precisely, where the table constrains it. */
		if (!constrainsFields(node.type)) {
			scope.problems.push(
				`${scope.pointer}: a "${node.type}" node carries a "fields" object.`,
			);
		}

		return;
	}

	const nested = { ...scope, pointer: `${scope.pointer}/fields`, prefix: [] };

	if (sub.kind === "fields") {
		checkValue({ ...nested, fields: sub.fields }, data);

		return;
	}

	const slug = data["blockType"];
	const block =
		typeof slug === "string"
			? blockOf(scope.config, sub.blocksField, slug)
			: undefined;

	if (!block) {
		scope.problems.push(
			`${scope.pointer}/fields: "${String(slug)}" is not allowed here. Allowed: ${blockSlugsOf(sub.blocksField).join(", ")}`,
		);

		return;
	}

	checkValue({ ...nested, fields: block.flattenedFields }, data);
};

/**
 * What the field's editor allows, carried down the walk so a node is judged
 * against the editor it lands in rather than against Lexical in general.
 */
interface EditorScope {
	allowed: readonly string[];
	field: RichTextField | undefined;
	nodeOptions: NodeOptions | undefined;
}

/**
 * An absent property is already reported as missing. Anything else present is
 * checked, not just a string: Lexical stores a heading tag of 3 as readily as
 * one of "h3".
 */
const checkNarrowedProperty = (
	scope: CheckScope,
	at: { pointer: string; type: string; values: readonly string[] },
	value: unknown,
): void => {
	if (
		value !== undefined &&
		!(typeof value === "string" && at.values.includes(value))
	) {
		scope.problems.push(
			`${at.pointer}: ${JSON.stringify(value)} is not available for a "${at.type}" node in this field's editor. Allowed: ${at.values.join(", ")}`,
		);
	}
};

/**
 * One node, wherever it came from. `pointer` addresses the node itself, so a
 * node written at a position and a node written inside a whole editor state
 * are held to the same rules and report them the same way.
 *
 * Payload does not check any of this: the Lexical validator runs node
 * validations only for the few node types that register one, so a `heading`
 * inside a field whose editor has no heading feature is stored without
 * complaint and only fails later, at render or when the document is reopened
 * in the admin editor. A key a node's fields do not declare is dropped just as
 * silently. The same holds one level down, for the node properties a feature
 * narrows: an `h3` in an editor restricted to `h4` is stored as readily as an
 * `h4`, and a node written without the properties its class hydrates from is
 * stored and then throws when the editor opens it.
 */
const checkNode = (
	scope: CheckScope,
	editor: EditorScope,
	node: unknown,
	pointer: string,
): void => {
	if (!isPlainObject(node) || typeof node["type"] !== "string") {
		scope.problems.push(`${pointer}: every node needs a "type".`);

		return;
	}

	const type = node["type"];

	if (!editor.allowed.includes(type)) {
		scope.problems.push(
			`${pointer}: "${type}" is not available in this field's editor. Allowed: ${editor.allowed.join(", ")}`,
		);

		return;
	}

	const problems = nodeProblems(node);

	if (problems.missing.length > 0) {
		scope.problems.push(
			`${pointer}: a "${type}" node is missing ${quoted(problems.missing)}. Write nodes as Lexical serializes them.`,
		);
	}

	for (const problem of problems.rejected) {
		scope.problems.push(
			`${pointer}/${problem.property}: a "${type}" node needs ${problem.needs} here.`,
		);
	}

	for (const [property, values] of Object.entries(
		editor.nodeOptions?.[type] ?? {},
	)) {
		checkNarrowedProperty(
			scope,
			{ pointer: `${pointer}/${property}`, type, values },
			node[property],
		);
	}

	if (editor.field) {
		checkNodeFields({ ...scope, pointer }, editor.field, {
			fields: node["fields"],
			type,
		});
	}

	checkNodes(scope, editor, node["children"], `${pointer}/children`);
};

/** `pointer` addresses the list. A node holding none is left alone. */
const checkNodes = (
	scope: CheckScope,
	editor: EditorScope,
	nodes: unknown,
	pointer: string,
): void => {
	if (!Array.isArray(nodes)) {
		return;
	}

	nodes.forEach((node, index) => {
		checkNode(scope, editor, node, `${pointer}/${String(index)}`);
	});
};

const checkRichText = (
	scope: CheckScope,
	editor: EditorScope,
	value: unknown,
): void => {
	if (!isPlainObject(value) || !isPlainObject(value["root"])) {
		scope.problems.push(
			`${scope.pointer}: expected a Lexical editor state with a "root".`,
		);

		return;
	}

	const root = value["root"];
	const { missing, rejected, unexpected } = rootProblems(root);

	if (missing.length > 0) {
		scope.problems.push(
			`${scope.pointer}/root: the root node is missing ${quoted(missing)}. Write nodes as Lexical serializes them.`,
		);
	}

	for (const problem of rejected) {
		scope.problems.push(
			`${scope.pointer}/root/${problem.property}: the root node needs ${problem.needs} here.`,
		);
	}

	for (const property of unexpected) {
		scope.problems.push(
			`${scope.pointer}/root/${property}: no such property on the root node. Available: ${Object.keys(ROOT_PROPERTIES).join(", ")}`,
		);
	}

	/* Same reason as at a position: an empty root is not a hydratable state. */
	if (Array.isArray(root["children"]) && root["children"].length === 0) {
		scope.problems.push(`${scope.pointer}/root/children: ${EMPTY_ROOT}`);
	}

	checkNodes(scope, editor, root["children"], `${scope.pointer}/root/children`);
};

/**
 * `type` decides how every other property on a node is read, so replacing it
 * alone would leave a heading shaped like a text node. Everything else is held
 * to the constraint the node walk holds it to and nothing more, since a
 * feature may put any property on a node.
 */
const checkNodeProperty = (
	scope: CheckScope,
	editor: EditorScope,
	position: LexicalPosition & { kind: "property" },
	value: unknown,
): void => {
	const { nodeType: type, property } = position;

	if (property === "type") {
		scope.problems.push(
			`${scope.pointer}: a node's "type" cannot be replaced on its own. Replace the whole node.`,
		);

		return;
	}

	if (position.isRoot && !(property in ROOT_PROPERTIES)) {
		scope.problems.push(
			`${scope.pointer}: no such property on the root node. Available: ${Object.keys(ROOT_PROPERTIES).join(", ")}`,
		);

		return;
	}

	const problem = propertyProblem(type, property, value);

	if (problem) {
		scope.problems.push(
			`${scope.pointer}: a "${type}" node needs ${problem.needs} here.`,
		);
	}

	const values = editor.nodeOptions?.[type]?.[property];

	if (values) {
		checkNarrowedProperty(
			scope,
			{ pointer: scope.pointer, type, values },
			value,
		);
	}
};

/**
 * A value written at a position inside an editor state rather than as the
 * whole state.
 */
const checkLexicalWrite = (
	scope: CheckScope,
	position: LexicalPosition,
	value: unknown,
): void => {
	const editor: EditorScope = {
		allowed: position.descriptor.nodes ?? [],
		field: position.field,
		nodeOptions: position.descriptor.nodeOptions,
	};

	if (position.kind === "property") {
		checkNodeProperty(scope, editor, position, value);

		return;
	}

	if (position.kind === "nodes") {
		if (!Array.isArray(value)) {
			scope.problems.push(`${scope.pointer}: expected an array of nodes.`);

			return;
		}

		if (position.isRoot && value.length === 0) {
			scope.problems.push(`${scope.pointer}: ${EMPTY_ROOT}`);

			return;
		}

		checkNodes(scope, editor, value, scope.pointer);

		return;
	}

	if (position.isRoot) {
		scope.problems.push(
			`${scope.pointer}: the root of an editor state cannot be replaced on its own. Write the whole field instead.`,
		);

		return;
	}

	checkNode(scope, editor, value, scope.pointer);
};

const checkLeafValue = (
	scope: CheckScope,
	descriptor: FieldDescriptor,
	value: unknown,
): void => {
	if (descriptor.readOnly) {
		scope.problems.push(
			`${scope.pointer}: this field is read-only and cannot be written.`,
		);

		return;
	}

	if (descriptor.type === "richText") {
		checkRichText(
			scope,
			{
				allowed: descriptor.nodes ?? [],
				field: findRichTextField(scope.fields, splitPath(descriptor.path)),
				nodeOptions: descriptor.nodeOptions,
			},
			value,
		);

		return;
	}

	if (descriptor.type !== "blocks") {
		return;
	}

	if (!Array.isArray(value)) {
		scope.problems.push(`${scope.pointer}: expected an array of blocks.`);

		return;
	}

	const field = findBlocksField(scope.fields, splitPath(descriptor.path));

	if (!field) {
		return;
	}

	value.forEach((row, index) => {
		const slug = isPlainObject(row) ? row["blockType"] : undefined;
		const block =
			typeof slug === "string" ? blockOf(scope.config, field, slug) : undefined;

		if (!block) {
			scope.problems.push(
				`${scope.pointer}/${String(index)}: "${String(slug)}" is not allowed here. Allowed: ${blockSlugsOf(field).join(", ")}`,
			);

			return;
		}

		checkValue(
			{
				...scope,
				fields: block.flattenedFields,
				pointer: `${scope.pointer}/${String(index)}`,
				prefix: [],
			},
			row,
		);
	});
};

/**
 * Reports every shape problem rather than the first.
 *
 * Shape only: unknown field names, unknown block slugs, read-only fields, and
 * rich text nodes or node properties the field's editor cannot produce.
 * Required-ness, row counts, lengths, enum membership and relationship
 * existence stay with Payload, which already checks them and reports them per
 * field. Without this pass a misspelled field inside a new block would be
 * stripped in silence.
 */
const checkValue = (scope: CheckScope, value: unknown): void => {
	if (!isPlainObject(value)) {
		return;
	}

	const prefixParts = scope.prefix;

	const relative = describeAddressableFields(scope.fields).flatMap(
		(descriptor) => {
			const parts = splitPath(descriptor.path);

			return prefixParts.every((part, offset) => part === parts[offset])
				? [{ descriptor, parts: parts.slice(prefixParts.length) }]
				: [];
		},
	);

	for (const [key, entry] of Object.entries(value)) {
		if (TOLERATED_VALUE_KEYS.has(key)) {
			continue;
		}

		const candidates = relative.filter(({ parts }) => parts[0] === key);
		const pointer = `${scope.pointer}/${key}`;

		if (candidates.length === 0) {
			scope.problems.push(
				`${pointer}: no such field. Available: ${[
					...new Set(relative.map(({ parts }) => parts[0])),
				].join(", ")}`,
			);

			continue;
		}

		const exact = candidates.find(({ parts }) => parts.length === 1);

		if (exact) {
			checkLeafValue({ ...scope, pointer }, exact.descriptor, entry);

			continue;
		}

		if (candidates.some(({ parts }) => parts[1] === ARRAY_MARKER)) {
			if (!Array.isArray(entry)) {
				scope.problems.push(`${pointer}: expected an array.`);

				continue;
			}

			entry.forEach((row, index) => {
				checkValue(
					{
						...scope,
						pointer: `${pointer}/${String(index)}`,
						prefix: [...prefixParts, key, ARRAY_MARKER],
					},
					row,
				);
			});

			continue;
		}

		checkValue({ ...scope, pointer, prefix: [...prefixParts, key] }, entry);
	}
};

/**
 * Shape problems with a value about to be written at a resolved pointer.
 */
export const validateWriteValue = (
	config: SanitizedConfig,
	target: { pointer: string; resolution: PointerResolution },
	value: unknown,
): string[] => {
	const problems: string[] = [];

	const scope: CheckScope = {
		config,
		fields: target.resolution.fields,
		pointer: target.pointer,
		prefix: target.resolution.prefix,
		problems,
	};

	if (target.resolution.lexical) {
		checkLexicalWrite(scope, target.resolution.lexical, value);

		return problems;
	}

	if (target.resolution.descriptor) {
		checkLeafValue(scope, target.resolution.descriptor, value);

		return problems;
	}

	checkValue(scope, value);

	return problems;
};
