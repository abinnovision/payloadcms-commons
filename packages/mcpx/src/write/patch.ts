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
const JSON_POINTER_PATTERN = /^(\/([^~/]|~[01])*)*$/;

const PATCH_OPERATION_SCHEMA = z
	.object({
		from: z.string().regex(JSON_POINTER_PATTERN).optional(),
		op: z.enum(["add", "copy", "move", "remove", "replace", "test"]),
		path: z.string().regex(JSON_POINTER_PATTERN),
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
const stripRowIds = (value: unknown): unknown => {
	const next = structuredClone(value);

	walkRows(next, (row) => {
		delete row["id"];
	});

	return next;
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
	const prepared = patches.map((operation) => {
		// Values are cloned so the written document never shares references
		// with the caller's operations.
		const cloned =
			"value" in operation
				? { ...operation, value: structuredClone<unknown>(operation.value) }
				: operation;

		// A localized field may have no value at all in the target locale.
		// `replace` requires an existing value, so an absent field is set with
		// `add` instead; element pointers keep replace semantics.
		if (
			cloned.op === "replace" &&
			!isElementPointer(cloned.path) &&
			(Pointer.fromJSON(cloned.path).get(next) as unknown) === undefined
		) {
			return { ...cloned, op: "add" as const };
		}

		return cloned;
	}) as Operation[];

	const problems = applyPatch(next, prepared).flatMap((error, index) =>
		error ? [`patches[${String(index)}]: ${error.message}`] : [],
	);

	if (problems.length > 0) {
		return { problems };
	}

	reconcileRowIds(next, doc);

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

		if (pointers.includes("")) {
			return [
				`${at}: an empty pointer addresses the whole document. Address a field instead.`,
			];
		}

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
