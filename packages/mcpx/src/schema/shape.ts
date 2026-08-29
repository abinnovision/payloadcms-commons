import { lexicalSubSchema } from "./lexical.js";
import {
	ARRAY_MARKER,
	blockOf,
	blockSlugsOf,
	describeAddressableFields,
	findBlocksField,
	findRichTextField,
	splitPath,
} from "./walk.js";

import type { NodeOptions } from "./lexical.js";
import type { PointerResolution } from "./pointer.js";
import type { FieldDescriptor } from "./walk.js";
import type { FlattenedField, RichTextField, SanitizedConfig } from "payload";

/**
 * Keys Payload manages on a row that a client may echo back harmlessly.
 */
const TOLERATED_VALUE_KEYS = new Set(["blockName", "blockType", "id"]);

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

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
 * Checks the fields a single Lexical node carries against the schema its
 * feature declares for that node type.
 *
 * A node with nothing to declare, and one whose sub-fields cannot be named at
 * a position, are both left alone.
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
		scope.problems.push(
			`${scope.pointer}: a "${node.type}" node carries a "fields" object.`,
		);

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
 * Checks an editor state against what the field's editor can actually
 * produce: every node type, and the fields each node carries.
 *
 * Payload does not: the Lexical validator runs node validations only for the
 * few node types that register one, so a `heading` inside a field whose
 * editor has no heading feature is stored without complaint and only fails
 * later, at render or when the document is reopened in the admin editor. A key
 * a node's fields do not declare is dropped just as silently. The same holds
 * one level down, for the node properties a feature narrows: an `h3` in an
 * editor restricted to `h4` is stored as readily as an `h4`.
 */
const checkRichText = (
	scope: CheckScope,
	editor: {
		allowed: readonly string[];
		field: RichTextField | undefined;
		nodeOptions: NodeOptions | undefined;
	},
	value: unknown,
): void => {
	if (!isPlainObject(value) || !isPlainObject(value["root"])) {
		scope.problems.push(
			`${scope.pointer}: expected a Lexical editor state with a "root".`,
		);

		return;
	}

	const walk = (nodes: unknown, pointer: string): void => {
		if (!Array.isArray(nodes)) {
			return;
		}

		nodes.forEach((node, index) => {
			const at = `${pointer}/${String(index)}`;

			if (!isPlainObject(node) || typeof node["type"] !== "string") {
				scope.problems.push(`${at}: every node needs a "type".`);

				return;
			}

			if (!editor.allowed.includes(node["type"])) {
				scope.problems.push(
					`${at}: "${node["type"]}" is not available in this field's editor. Allowed: ${editor.allowed.join(", ")}`,
				);

				return;
			}

			for (const [property, values] of Object.entries(
				editor.nodeOptions?.[node["type"]] ?? {},
			)) {
				const value = node[property];

				if (typeof value === "string" && !values.includes(value)) {
					scope.problems.push(
						`${at}/${property}: "${value}" is not available for a "${node["type"]}" node in this field's editor. Allowed: ${values.join(", ")}`,
					);
				}
			}

			if (editor.field) {
				checkNodeFields({ ...scope, pointer: at }, editor.field, {
					fields: node["fields"],
					type: node["type"],
				});
			}

			walk(node["children"], `${at}/children`);
		});
	};

	walk(value["root"]["children"], `${scope.pointer}/root/children`);
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
 * Walks an incoming value against the schema, reporting every shape problem
 * rather than the first.
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

	if (target.resolution.descriptor) {
		checkLeafValue(scope, target.resolution.descriptor, value);

		return problems;
	}

	checkValue(scope, value);

	return problems;
};
