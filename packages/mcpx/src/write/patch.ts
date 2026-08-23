import { applyPatch, Pointer } from "rfc6902";
import { z } from "zod";

import { RESERVED_FIELD_NAMES } from "./reserved.js";

import type { JsonObject } from "payload";
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

export type { PatchOperation };
export {
	applyPatchToCopy,
	droppedPointer,
	isElementPointer,
	isReservedPointer,
	PATCH_OPERATION_SCHEMA,
	stripRowIds,
};
