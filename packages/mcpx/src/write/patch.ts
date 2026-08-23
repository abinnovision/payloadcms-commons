import { applyPatch, Pointer } from "rfc6902";
import { z } from "zod";

import { resolveDataPointer } from "../schema/pointer.js";
import { validateWriteValue } from "../schema/shape.js";
import {
	ARRAY_MARKER,
	blockOf,
	describeFields,
	findBlocksField,
	RESERVED_FIELD_NAMES,
	splitPath,
} from "../schema/walk.js";

import type {
	FlattenedField,
	JsonObject,
	SanitizedCollectionConfig,
	SanitizedConfig,
} from "payload";
import type { Operation } from "rfc6902";

type PatchOperation = Operation;

/**
 * One RFC 6902 operation as accepted by `patchDocument`.
 */
const PATCH_OPERATION_SCHEMA = z
	.object({
		from: z.string().optional(),
		op: z.enum(["add", "copy", "move", "remove", "replace", "test"]),
		path: z.string(),
		value: z.unknown().optional(),
	})
	.describe("An RFC 6902 operation.");

/**
 * Whether a pointer touches a field Payload maintains.
 */
const isReservedPointer = (pointer: string): boolean =>
	pointer
		.split("/")
		.slice(1)
		.some((segment) => RESERVED_FIELD_NAMES.has(segment));

/**
 * The pointer an operation removes a value from, if it removes one at all.
 */
const droppedPointer = (operation: Operation): string | undefined => {
	if (operation.op === "remove") {
		return operation.path;
	}

	return operation.op === "move" ? operation.from : undefined;
};

/**
 * Whether a pointer addresses a list element rather than a field.
 */
const isElementPointer = (pointer: string): boolean => {
	const last = pointer.split("/").pop() ?? "";

	return last === "-" || /^\d+$/.test(last);
};

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * A Lexical editor state. Its nodes manage their own ids, so it is never
 * descended into.
 */
const isRichTextState = (value: Record<string, unknown>): boolean =>
	isPlainObject(value["root"]) && Array.isArray(value["root"]["children"]);

/**
 * Removes row ids from an incoming value so Payload assigns fresh ones.
 *
 * A row is a plain object that carries `blockType` or sits directly inside an
 * array. Copying or re-adding a row would otherwise duplicate its id, which SQL
 * adapters reject as a primary key violation. Rich text states and scalar
 * values, including relationship ids, are left untouched.
 */
const stripRowIds = (value: unknown, isRow = false): unknown => {
	if (Array.isArray(value)) {
		return value.map((entry) => stripRowIds(entry, true));
	}

	if (!isPlainObject(value) || isRichTextState(value)) {
		return value;
	}

	const dropId = isRow || typeof value["blockType"] === "string";

	return Object.fromEntries(
		Object.entries(value)
			.filter(([key]) => !(dropId && key === "id"))
			.map(([key, entry]) => [key, stripRowIds(entry)]),
	);
};

/**
 * Replaces the value at `pointer` with its id-stripped copy. An append pointer
 * (`/-`) is resolved to the last element of its list.
 */
const stripRowIdsAt = (doc: JsonObject, pointer: string): void => {
	const segments = pointer.split("/").slice(1);
	const parent = Pointer.fromJSON(["", ...segments.slice(0, -1)].join("/")).get(
		doc,
	) as unknown;
	const last = segments.at(-1);

	if (last === undefined || parent === null || typeof parent !== "object") {
		return;
	}

	const key =
		last === "-" && Array.isArray(parent) ? String(parent.length - 1) : last;
	const target = parent as Record<string, unknown>;

	target[key] = stripRowIds(target[key], isElementPointer(`/${key}`));
};

/**
 * Applies a patch to a deep copy of the document, so a failing operation
 * leaves the original untouched and nothing partial is ever written.
 */
const applyPatchToCopy = (
	doc: JsonObject,
	patches: Operation[],
): { next: JsonObject } | { problems: string[] } => {
	const next = structuredClone(doc);
	const prepared = patches.map((operation) =>
		"value" in operation
			? { ...operation, value: stripRowIds(operation.value) }
			: operation,
	) as Operation[];

	const problems = applyPatch(next, prepared).flatMap((error, index) =>
		error ? [`patches[${String(index)}]: ${error.message}`] : [],
	);

	if (problems.length > 0) {
		return { problems };
	}

	// A copy takes its value from the document, so its row ids are stripped at
	// the target once it is in place.
	for (const operation of prepared) {
		if (operation.op === "copy") {
			stripRowIdsAt(next, operation.path);
		}
	}

	return { next };
};

/**
 * Checks every operation against the schema before any is applied.
 *
 * A partially applied batch is worse than a refused one, so this returns all
 * problems and the caller applies nothing unless the list is empty.
 */
const findPatchProblems = (
	config: SanitizedConfig,
	target: { collection: string; doc: unknown; patches: Operation[] },
): string[] =>
	target.patches.flatMap((operation, index) => {
		const at = `patches[${String(index)}]`;
		const pointers = [
			operation.path,
			...("from" in operation && operation.from ? [operation.from] : []),
		];

		const reserved = pointers.find(isReservedPointer);

		if (reserved !== undefined) {
			return [
				`${at}: "${reserved}" addresses a field Payload maintains. Drafts are the only thing this tool writes, and id, _status, createdAt and updatedAt are not writable.`,
			];
		}

		const dropped = droppedPointer(operation);

		if (dropped !== undefined && !isElementPointer(dropped)) {
			return [
				`${at}: "${dropped}" is a field, not a list element, and removing it would do nothing. The patched document is written whole, and Payload keeps any field absent from a write rather than clearing it. Use "replace" with null to clear a field, or with [] to empty a list.`,
			];
		}

		const value: unknown = "value" in operation ? operation.value : undefined;

		try {
			const moved =
				"from" in operation && operation.from
					? (Pointer.fromJSON(operation.from).get(target.doc) as unknown)
					: undefined;

			for (const pointer of pointers) {
				const resolution = resolveDataPointer(config, {
					addedValue: value ?? moved,
					collection: target.collection,
					doc: target.doc,
					pointer,
				});

				if (pointer === operation.path && value !== undefined) {
					return validateWriteValue(config, { pointer, resolution }, value).map(
						(problem) => `${at}: ${problem}`,
					);
				}
			}

			return [];
		} catch (error) {
			return [`${at}: ${error instanceof Error ? error.message : "invalid"}`];
		}
	});

/**
 * Keys Payload manages on a row that travel back into the write unchanged.
 */
const ROW_KEYS = new Set(["blockName", "blockType", "id"]);

/**
 * Picks the keys the schema walker describes out of `value`, descending into
 * groups, named tabs, arrays and blocks. Everything Payload maintains or
 * derives (`_status`, timestamps, join and virtual fields, upload base fields)
 * is left out, so the write-back carries only what a client could have set.
 */
const pickDescribed = (
	config: SanitizedConfig,
	value: Record<string, unknown>,
	at: { fields: FlattenedField[]; prefix: readonly string[]; isRow: boolean },
): Record<string, unknown> => {
	const { fields, prefix, isRow } = at;
	const relative = describeFields(fields).flatMap((descriptor) => {
		const parts = splitPath(descriptor.path);

		return prefix.every((part, offset) => part === parts[offset])
			? [{ descriptor, parts: parts.slice(prefix.length) }]
			: [];
	});

	const result: Record<string, unknown> = {};

	if (isRow) {
		for (const key of ROW_KEYS) {
			if (key in value) {
				result[key] = value[key];
			}
		}
	}

	for (const [key, entry] of Object.entries(value)) {
		const candidates = relative.filter(({ parts }) => parts[0] === key);

		if (candidates.length === 0) {
			continue;
		}

		const exact = candidates.find(({ parts }) => parts.length === 1);

		if (exact?.descriptor.type === "blocks" && Array.isArray(entry)) {
			const field = findBlocksField(fields, splitPath(exact.descriptor.path));

			result[key] = (entry as unknown[]).map((row) => {
				const block =
					field && isPlainObject(row) && typeof row["blockType"] === "string"
						? blockOf(config, field, row["blockType"])
						: undefined;

				return block && isPlainObject(row)
					? pickDescribed(config, row, {
							fields: block.flattenedFields,
							prefix: [],
							isRow: true,
						})
					: row;
			});

			continue;
		}

		if (exact) {
			result[key] = entry;

			continue;
		}

		if (candidates.some(({ parts }) => parts[1] === ARRAY_MARKER)) {
			result[key] = Array.isArray(entry)
				? (entry as unknown[]).map((row) =>
						isPlainObject(row)
							? pickDescribed(config, row, {
									fields,
									prefix: [...prefix, key, ARRAY_MARKER],
									isRow: true,
								})
							: row,
					)
				: entry;

			continue;
		}

		result[key] = isPlainObject(entry)
			? pickDescribed(config, entry, {
					fields,
					prefix: [...prefix, key],
					isRow: false,
				})
			: entry;
	}

	return result;
};

/**
 * The data handed to `payload.update` after a patch: the patched document
 * reduced to the fields the client may write, plus row identity keys.
 */
const buildWriteData = (
	config: SanitizedConfig,
	collection: SanitizedCollectionConfig,
	doc: JsonObject,
): JsonObject => {
	return pickDescribed(config, doc, {
		fields: collection.flattenedFields,
		prefix: [],
		isRow: false,
	});
};

export type { PatchOperation };
export {
	applyPatchToCopy,
	buildWriteData,
	droppedPointer,
	findPatchProblems,
	isElementPointer,
	isReservedPointer,
	PATCH_OPERATION_SCHEMA,
	stripRowIds,
};
