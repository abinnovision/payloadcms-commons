import { applyPatch, Pointer } from "rfc6902";

import { reconcileRowIds } from "./row-ids.js";
import {
	resolveDataPointer,
	validateWriteValue,
	EMPTY_ROOT,
	describeAddressableFields,
	isIndexSegment,
	joinPath,
	prototypeSegmentProblem,
	RESERVED_FIELD_NAMES,
	SchemaError,
	splitPath,
} from "../schema/index.js";

import type { EntityRef } from "../entity.js";
import type { PointerResolution } from "../schema/index.js";
import type { JsonObject, SanitizedConfig } from "payload";
import type { Operation } from "rfc6902";

/** Re-exported so callers do not depend on the `rfc6902` package directly. */
export type PatchOperation = Operation;

export const isReservedPointer = (pointer: string): boolean =>
	pointer
		.split("/")
		.slice(1)
		.some((segment) => RESERVED_FIELD_NAMES.has(segment));

export const droppedPointer = (operation: Operation): string | undefined => {
	if (operation.op === "remove") {
		return operation.path;
	}

	return operation.op === "move" ? operation.from : undefined;
};

export const isElementPointer = (pointer: string): boolean => {
	return isIndexSegment(pointer.split("/").pop() ?? "");
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

/** The one it carries, or the one it takes from `from`. `remove` writes nothing. */
const effectiveValue = (operation: Operation, doc: JsonObject): unknown => {
	if ("value" in operation) {
		return operation.value;
	}

	return "from" in operation
		? (Pointer.fromJSON(operation.from).get(doc) as unknown)
		: undefined;
};

/** A pointer stopping short addresses a subtree; the fields beneath decide. */
const resolvesReadOnly = (resolution: PointerResolution): boolean => {
	if (resolution.readOnly) {
		return true;
	}

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

/** An element has no descriptor, so its field is read one segment up. */
const isReadOnlyPointer = (
	config: SanitizedConfig,
	target: { doc: JsonObject; pointer: string; ref: EntityRef },
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

/** Unresolvable pointers say nothing here; the caller reports them anyway. */
const resolutionAt = (
	config: SanitizedConfig,
	target: { doc: JsonObject; pointer: string; ref: EntityRef },
): PointerResolution | undefined => {
	try {
		return resolveDataPointer(config, {
			doc: target.doc,
			pointer: target.pointer,
			ref: target.ref,
		});
	} catch {
		return undefined;
	}
};

/**
 * Removing a field does nothing, but removing part of an editor state does
 * something, and something worse: a node written without the properties its
 * class hydrates from throws when the admin editor opens it. Both are refused,
 * and only the reason differs.
 */
const droppedFieldProblem = (
	config: SanitizedConfig,
	target: { doc: JsonObject; pointer: string; ref: EntityRef },
): string => {
	const resolution = resolutionAt(config, target);
	const lexical = resolution?.lexical;

	if (lexical?.kind === "property") {
		return `"${target.pointer}" is a node property, not a list element. A "${lexical.nodeType}" node needs it, so replace it rather than removing it.`;
	}

	if (lexical ?? resolution?.inLexical) {
		return `"${target.pointer}" sits inside an editor state, which is written whole, so removing it would take effect and leave a node the admin editor cannot open. Replace it instead, or remove the node that holds it.`;
	}

	return `"${target.pointer}" is a field, not a list element, and removing it would do nothing. The patched document is written whole, and Payload keeps any field absent from a write rather than clearing it. Use "replace" with null to clear a field, or with [] to empty a list.`;
};

/**
 * Dropping the only node under a root empties the state, which Lexical refuses
 * to hydrate. Checked here rather than on the written value, because a
 * `remove` carries none.
 */
const emptiesTheRoot = (
	config: SanitizedConfig,
	target: { doc: JsonObject; pointer: string; ref: EntityRef },
): boolean => {
	const list = joinPath(splitPath(target.pointer).slice(0, -1));
	const owner = resolutionAt(config, { ...target, pointer: list })?.lexical;

	if (owner?.kind !== "nodes" || owner.isRoot !== true) {
		return false;
	}

	const nodes = Pointer.fromJSON(list).get(target.doc) as unknown;

	return Array.isArray(nodes) && nodes.length === 1;
};

/**
 * Checked against the document as it stands when this operation runs: both
 * pointers must resolve, the written value must pass write validation, and what
 * it drops must not sit in a read-only field.
 */
const findOperationProblems = (
	config: SanitizedConfig,
	target: { doc: JsonObject; operation: Operation; ref: EntityRef },
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

	const prototyped = pointers
		.map(prototypeSegmentProblem)
		.find((problem) => problem !== undefined);

	if (prototyped !== undefined) {
		return [prototyped];
	}

	const reserved = pointers.find(isReservedPointer);

	if (reserved !== undefined) {
		return [
			`"${reserved}" addresses a field Payload maintains. This tool only ever writes drafts, and id, _status, createdAt and updatedAt are not writable; use publishDocument to publish.`,
		];
	}

	const dropped = droppedPointer(operation);

	if (dropped !== undefined && !isElementPointer(dropped)) {
		return [droppedFieldProblem(config, { doc, pointer: dropped, ref })];
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

		if (
			dropped !== undefined &&
			emptiesTheRoot(config, { doc, pointer: dropped, ref })
		) {
			return [`"${dropped}": ${EMPTY_ROOT}`];
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
		if (!(error instanceof SchemaError)) {
			throw error;
		}

		return [error.message];
	}
};

/**
 * One evolving copy, so an operation depending on an earlier one resolves
 * against the shape it actually modifies, and a failure leaves the original
 * untouched. The caller writes nothing unless the whole batch came back
 * applied, so a partial batch is never persisted.
 */
export const applyPatchOperations = (
	config: SanitizedConfig,
	target: { doc: JsonObject; patches: Operation[]; ref: EntityRef },
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
