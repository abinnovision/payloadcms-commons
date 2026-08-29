import { applyPatch, Pointer } from "rfc6902";
import { z } from "zod";

import {
	resolveDataPointer,
	validateWriteValue,
	ARRAY_MARKER,
	blockOf,
	describeAddressableFields,
	findBlocksField,
	joinPath,
	JSON_POINTER_PATTERN,
	RESERVED_FIELD_NAMES,
	splitPath,
} from "../schema/index.js";

import type { PointerResolution, TargetRef } from "../schema/index.js";
import type { FlattenedField, JsonObject, SanitizedConfig } from "payload";
import type { Operation } from "rfc6902";

export type PatchOperation = Operation;

const POINTER = z.string().regex(JSON_POINTER_PATTERN);

/**
 * One RFC 6902 operation as accepted by `patchDocument`. Discriminated on `op`
 * so an operation carries only the members RFC 6902 defines for it.
 */
export const PATCH_OPERATION_SCHEMA = z
	.discriminatedUnion("op", [
		z.strictObject({ op: z.literal("add"), path: POINTER, value: z.unknown() }),
		z.strictObject({ op: z.literal("remove"), path: POINTER }),
		z.strictObject({
			op: z.literal("replace"),
			path: POINTER,
			value: z.unknown(),
		}),
		z.strictObject({ from: POINTER, op: z.literal("move"), path: POINTER }),
		z.strictObject({ from: POINTER, op: z.literal("copy"), path: POINTER }),
		z.strictObject({
			op: z.literal("test"),
			path: POINTER,
			value: z.unknown(),
		}),
	])
	.describe("An RFC 6902 operation.");

/**
 * Whether a pointer touches a field Payload maintains.
 */
export const isReservedPointer = (pointer: string): boolean =>
	pointer
		.split("/")
		.slice(1)
		.some((segment) => RESERVED_FIELD_NAMES.has(segment));

/**
 * The pointer an operation removes a value from, if it removes one at all.
 */
export const droppedPointer = (operation: Operation): string | undefined => {
	if (operation.op === "remove") {
		return operation.path;
	}

	return operation.op === "move" ? operation.from : undefined;
};

/**
 * Whether a pointer addresses a list element rather than a field.
 */
export const isElementPointer = (pointer: string): boolean => {
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
 * Visits every row in a value: a plain object that carries `blockType` or
 * sits directly inside an array. Rich text states manage their own nodes and
 * are never descended into.
 */
const walkRows = (
	value: unknown,
	visit: (row: Record<string, unknown>) => void,
	isRow = false,
): void => {
	if (Array.isArray(value)) {
		for (const entry of value) {
			walkRows(entry, visit, true);
		}

		return;
	}

	if (!isPlainObject(value) || isRichTextState(value)) {
		return;
	}

	if (isRow || typeof value["blockType"] === "string") {
		visit(value);
	}

	for (const entry of Object.values(value)) {
		walkRows(entry, visit);
	}
};

/**
 * Keeps a row id only when the stored document already has it and no earlier
 * row in the write claimed it; every other id is dropped so Payload assigns a
 * fresh one.
 *
 * A kept id makes Payload update the row in place, which preserves the other
 * locales of any localized field inside it. A duplicated id (a copied row) or
 * an id from elsewhere would violate a SQL primary key, so those never pass.
 */
const reconcileRowIds = (next: JsonObject, stored: JsonObject): void => {
	const known = new Set<unknown>();

	walkRows(stored, (row) => {
		if (row["id"] !== undefined) {
			known.add(row["id"]);
		}
	});

	const seen = new Set<unknown>();

	walkRows(next, (row) => {
		const id = row["id"];

		if (id === undefined) {
			return;
		}

		if (known.has(id) && !seen.has(id)) {
			seen.add(id);

			return;
		}

		delete row["id"];
	});
};

/**
 * Drops every row id from a copy of `value`. Used on create, where no stored
 * row exists and any incoming id is client-invented.
 */
export const stripRowIds = (value: unknown): unknown => {
	const next = structuredClone(value);

	walkRows(next, (row) => {
		delete row["id"];
	});

	return next;
};

/**
 * The operation as it is applied: values are cloned so the written document
 * never shares references with the caller's operations, and a `replace` of a
 * field the target locale has no value for becomes an `add`, which is what
 * RFC 6902 requires when nothing is there to replace.
 */
const prepare = (operation: Operation, doc: JsonObject): Operation => {
	const cloned =
		"value" in operation
			? { ...operation, value: structuredClone<unknown>(operation.value) }
			: operation;

	return cloned.op === "replace" &&
		!isElementPointer(cloned.path) &&
		(Pointer.fromJSON(cloned.path).get(doc) as unknown) === undefined
		? { ...cloned, op: "add" as const }
		: cloned;
};

/**
 * The value an operation writes at its path: the one it carries, or the one it
 * takes from `from`. A `remove` writes nothing.
 */
const effectiveValue = (operation: Operation, doc: JsonObject): unknown => {
	if ("value" in operation) {
		return operation.value;
	}

	return "from" in operation
		? (Pointer.fromJSON(operation.from).get(doc) as unknown)
		: undefined;
};

/**
 * Whether a resolved pointer lands in a read-only field. A pointer that stops
 * short of one addresses a subtree, and the fields beneath it decide.
 */
const resolvesReadOnly = (resolution: PointerResolution): boolean => {
	if (resolution.descriptor) {
		return resolution.descriptor.readOnly === true;
	}

	const below = describeAddressableFields(resolution.fields).filter(
		(descriptor) =>
			resolution.prefix.every(
				(part, offset) => part === splitPath(descriptor.path)[offset],
			),
	);

	return below.length > 0 && below.every((descriptor) => descriptor.readOnly);
};

/**
 * Whether the pointer addresses something read-only. An element carries no
 * descriptor of its own, so the field it belongs to is read one segment up.
 */
const isReadOnlyPointer = (
	config: SanitizedConfig,
	target: { doc: JsonObject; pointer: string; ref: TargetRef },
): boolean =>
	resolvesReadOnly(
		resolveDataPointer(config, {
			doc: target.doc,
			pointer: isElementPointer(target.pointer)
				? joinPath(splitPath(target.pointer).slice(0, -1))
				: target.pointer,
			ref: target.ref,
		}),
	);

/**
 * Checks one operation against the schema, in the state the document is in
 * when that operation runs. Both pointers must resolve, whatever the operation
 * writes at its path must pass write validation, and what it drops must not sit
 * in a read-only field.
 */
const findOperationProblems = (
	config: SanitizedConfig,
	target: { doc: JsonObject; operation: Operation; ref: TargetRef },
): string[] => {
	const { doc, operation, ref } = target;
	const pointers = [
		operation.path,
		...("from" in operation ? [operation.from] : []),
	];

	if (pointers.includes("")) {
		return [
			"an empty pointer addresses the whole document. Address a field instead.",
		];
	}

	const reserved = pointers.find(isReservedPointer);

	if (reserved !== undefined) {
		return [
			`"${reserved}" addresses a field Payload maintains. Drafts are the only thing this tool writes, and id, _status, createdAt and updatedAt are not writable.`,
		];
	}

	const dropped = droppedPointer(operation);

	if (dropped !== undefined && !isElementPointer(dropped)) {
		return [
			`"${dropped}" is a field, not a list element, and removing it would do nothing. The patched document is written whole, and Payload keeps any field absent from a write rather than clearing it. Use "replace" with null to clear a field, or with [] to empty a list.`,
		];
	}

	try {
		const value = effectiveValue(operation, doc);

		if (
			value !== undefined &&
			operation.op !== "test" &&
			isReadOnlyPointer(config, { doc, pointer: operation.path, ref })
		) {
			return [`"${operation.path}" is read-only and cannot be written.`];
		}

		if (
			dropped !== undefined &&
			isReadOnlyPointer(config, { doc, pointer: dropped, ref })
		) {
			return [`"${dropped}" sits in a read-only field and cannot be removed.`];
		}

		for (const pointer of pointers) {
			const resolution = resolveDataPointer(config, {
				addedValue: value,
				doc,
				pointer,
				ref,
			});

			if (pointer === operation.path && value !== undefined) {
				const problems = validateWriteValue(
					config,
					{ pointer, resolution },
					value,
				);

				if (problems.length > 0) {
					return problems;
				}
			}
		}

		return [];
	} catch (error) {
		return [error instanceof Error ? error.message : "invalid"];
	}
};

/**
 * Validates and applies every operation against one evolving copy of the
 * document, so an operation that depends on an earlier one resolves against
 * the shape it actually modifies.
 *
 * The copy means a failing operation leaves the original untouched, and the
 * caller writes nothing unless the whole batch came back applied, so a
 * partially applied batch is never persisted.
 */
export const applyPatchOperations = (
	config: SanitizedConfig,
	target: { doc: JsonObject; patches: Operation[]; ref: TargetRef },
): { next: JsonObject } | { problems: string[] } => {
	const next = structuredClone(target.doc);

	for (const [index, operation] of target.patches.entries()) {
		const at = `patches[${String(index)}]`;
		const problems = findOperationProblems(config, {
			doc: next,
			operation,
			ref: target.ref,
		});

		if (problems.length > 0) {
			return { problems: problems.map((problem) => `${at}: ${problem}`) };
		}

		const [error] = applyPatch(next, [prepare(operation, next)]);

		if (error) {
			return { problems: [`${at}: ${error.message}`] };
		}
	}

	reconcileRowIds(next, target.doc);

	return { next };
};

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
	const relative = describeAddressableFields(fields).flatMap((descriptor) => {
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
export const buildWriteData = (
	config: SanitizedConfig,
	/*
	 * Widened to the structural minimum this reads, so a sanitized collection
	 * and a sanitized global both satisfy it without a union.
	 */
	target: { flattenedFields: FlattenedField[] },
	doc: JsonObject,
): JsonObject => {
	return pickDescribed(config, doc, {
		fields: target.flattenedFields,
		prefix: [],
		isRow: false,
	});
};
