import {
	ARRAY_MARKER,
	blockOf,
	blockSlugsOf,
	describeFields,
	findBlocksField,
	splitPath,
} from "./walk.js";

import type { PointerResolution } from "./pointer.js";
import type { FieldDescriptor } from "./walk.js";
import type { FlattenedField, SanitizedConfig } from "payload";

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
 * Checks every node type in an editor state against what the field's editor
 * can actually produce.
 *
 * Payload does not: the Lexical validator runs node validations only for the
 * few node types that register one, so a `heading` inside a field whose
 * editor has no heading feature is stored without complaint and only fails
 * later, at render or when the document is reopened in the admin editor.
 */
const checkRichText = (
	scope: Pick<CheckScope, "pointer" | "problems">,
	allowed: readonly string[],
	value: unknown,
): void => {
	if (!isPlainObject(value) || !isPlainObject(value["root"])) {
		scope.problems.push(
			`${scope.pointer}: expected a Lexical editor state with a "root".`,
		);

		return;
	}

	const walk = (nodes: unknown): void => {
		if (!Array.isArray(nodes)) {
			return;
		}

		for (const node of nodes) {
			if (!isPlainObject(node) || typeof node["type"] !== "string") {
				scope.problems.push(`${scope.pointer}: every node needs a "type".`);

				continue;
			}

			if (!allowed.includes(node["type"])) {
				scope.problems.push(
					`${scope.pointer}: "${node["type"]}" is not available in this field's editor. Allowed: ${allowed.join(", ")}`,
				);
			}

			walk(node["children"]);
		}
	};

	walk(value["root"]["children"]);
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
		checkRichText(scope, descriptor.nodes ?? [], value);

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
 * Shape only: unknown field names, unknown block slugs, read-only fields and
 * unusable rich text nodes. Required-ness, row counts, enum membership and
 * relationship existence stay with Payload, which already checks them and
 * reports them per field. Without this pass a misspelled field inside a new
 * block would be stripped in silence.
 */
const checkValue = (scope: CheckScope, value: unknown): void => {
	if (!isPlainObject(value)) {
		return;
	}

	const prefixParts = scope.prefix;

	const relative = describeFields(scope.fields).flatMap((descriptor) => {
		const parts = splitPath(descriptor.path);

		return prefixParts.every((part, offset) => part === parts[offset])
			? [{ descriptor, parts: parts.slice(prefixParts.length) }]
			: [];
	});

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
const validateWriteValue = (
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

export { validateWriteValue };
