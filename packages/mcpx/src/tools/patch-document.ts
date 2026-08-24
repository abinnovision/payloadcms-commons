import { Pointer } from "rfc6902";
import { z } from "zod";

import {
	idShape,
	localeOf,
	localeShape,
	readTarget,
	targetShape,
} from "./shared.js";
import { refOf, requireIdFor, resolveTarget } from "./target.js";
import { errorResult, jsonResult } from "../endpoint/result.js";
import {
	applyPatchToCopy,
	buildWriteData,
	findPatchProblems,
	isElementPointer,
	PATCH_OPERATION_SCHEMA,
} from "../write/patch.js";
import { collectPublishBlockers } from "../write/publish-blockers.js";
import { withTransaction } from "../write/transaction.js";

import type { BuiltinTool } from "./types.js";
import type { PatchOperation } from "../write/patch.js";

const DESCRIPTION = `Applies RFC 6902 JSON Patch operations to one document.

Pass exactly one of "collection" and "global". "id" is required with "collection" and must be omitted with "global", because a global is a singleton.

The write always lands as a draft and is never published, whatever it contains; publishing stays a human action in the admin panel.

Only the fields describeSchema lists can be addressed. A pointer that does not resolve is refused with the fields that are valid at that point, and nothing is applied unless every operation in the batch validates first. describeSchema reports field paths in this same pointer syntax; a path becomes a pointer into a document by replacing each "*" and each block slug with its 0-based index.

Adding a block requires "blockType" on the value. Append with "/-" as the last segment. To clear a field use "replace" with null; an array or blocks field refuses null and is emptied with [] instead. "remove" is only for list elements, because a field left out of a write is kept rather than cleared. Read the document first to learn the indices, and pass its "updatedAt" as expectedUpdatedAt so a concurrent edit is refused rather than overwritten.

A successful write may come back with "publishBlockers": everything still wrong with the draft, such as required fields left empty. Those do not fail the write, because a draft is allowed to be incomplete, but a human cannot publish the document until the list is empty. "notApplied" lists pointers whose value Payload kept unchanged, which happens when field-level access denies the update.`;

interface Args {
	collection?: string;
	expectedUpdatedAt?: string;
	global?: string;
	id?: number | string;
	locale?: string;
	patches: PatchOperation[];
}

const sameInstant = (left: unknown, right: string): boolean =>
	typeof left === "string" &&
	new Date(left).getTime() === new Date(right).getTime();

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Whether the intended value survived the write. The saved document is
 * allowed to carry more than was sent: Payload assigns fresh row ids and
 * backfills defaults and nulls on save, so `id` keys are ignored and only
 * the keys the client sent are compared. Null and absent count as equal.
 */
const survives = (expected: unknown, actual: unknown): boolean => {
	if (expected === undefined || expected === null) {
		return actual === undefined || actual === null;
	}

	if (Array.isArray(expected)) {
		return (
			Array.isArray(actual) &&
			expected.length === actual.length &&
			expected.every((entry, index) => survives(entry, actual[index]))
		);
	}

	if (isPlainObject(expected)) {
		return (
			isPlainObject(actual) &&
			Object.entries(expected).every(
				([key, value]) => key === "id" || survives(value, actual[key]),
			)
		);
	}

	return isPlainObject(actual) || Array.isArray(actual)
		? false
		: JSON.stringify(expected) === JSON.stringify(actual);
};

/**
 * Pointers whose intended value did not survive the write. Element pointers
 * are skipped: an append pointer (`/-`) does not resolve against the saved
 * document.
 */
const notAppliedPointers = (
	patches: PatchOperation[],
	intended: Record<string, unknown>,
	saved: Record<string, unknown>,
): string[] =>
	patches.flatMap((operation) => {
		if (
			(operation.op !== "add" && operation.op !== "replace") ||
			isElementPointer(operation.path)
		) {
			return [];
		}

		const pointer = Pointer.fromJSON(operation.path);
		const expected = pointer.get(intended) as unknown;
		const actual = pointer.get(saved) as unknown;

		return survives(expected, actual) ? [] : [operation.path];
	});

const patchDocument: BuiltinTool<Args> = {
	name: "patchDocument",
	description: DESCRIPTION,
	annotations: {
		readOnlyHint: false,
		destructiveHint: false,
		idempotentHint: false,
		openWorldHint: false,
	},
	isEnabled: (scope) =>
		scope.writable.length + scope.writableGlobals.length > 0,
	inputSchema: (scope) => ({
		...targetShape(scope, "write", {
			collection: "Collection holding the document.",
			global: "Global to patch.",
		}),
		...idShape(scope, "write"),
		...localeShape(scope, {
			required: true,
			description:
				"Locale the patch applies to. Localized fields write here only.",
		}),
		patches: z
			.array(PATCH_OPERATION_SCHEMA)
			.min(1)
			.describe("Operations, applied in order."),
		expectedUpdatedAt: z
			.string()
			.optional()
			.describe(
				"The updatedAt read before patching. The write is refused if the document has changed since.",
			),
	}),
	handler: async (args, scope) => {
		const target = resolveTarget(scope, args, "write");
		const id = requireIdFor(target, args.id);
		const { payload } = scope.req;
		const locale = localeOf(scope, args.locale);

		return await withTransaction(scope.req, async () => {
			const doc = await readTarget(scope, { target, id, locale });

			if (
				args.expectedUpdatedAt !== undefined &&
				!sameInstant(doc["updatedAt"], args.expectedUpdatedAt)
			) {
				return errorResult(
					"The document changed since you read it. Read it again and re-apply the patch.",
					{ updatedAt: doc["updatedAt"] },
				);
			}

			const problems = findPatchProblems(payload.config, {
				doc,
				patches: args.patches,
				ref: refOf(target),
			});

			if (problems.length > 0) {
				return errorResult("No operation was applied.", { problems });
			}

			const applied = applyPatchToCopy(doc, args.patches);

			if ("problems" in applied) {
				return errorResult("No operation was applied.", {
					problems: applied.problems,
				});
			}

			const write = {
				data: buildWriteData(payload.config, target.config, applied.next),
				depth: 0,
				draft: true,
				overrideAccess: false,
				req: scope.req,
				...(locale === undefined ? {} : { locale }),
			};

			if (target.kind === "collection") {
				await payload.update({
					...write,
					collection: target.slug,
					id: id as number | string,
				});
			} else {
				await payload.updateGlobal({ ...write, slug: target.slug });
			}

			const saved = await readTarget(scope, {
				target,
				id,
				locale,
				privileged: true,
			});

			const notApplied = notAppliedPointers(args.patches, applied.next, saved);
			const publishBlockers = await collectPublishBlockers(scope.req, {
				doc: saved,
				entity: target,
			});

			return jsonResult({
				...(target.kind === "collection"
					? { id: saved["id"] }
					: { global: target.slug }),
				status: saved["_status"],
				updatedAt: saved["updatedAt"],
				...(publishBlockers.length > 0 ? { publishBlockers } : {}),
				...(notApplied.length > 0 ? { notApplied } : {}),
			});
		});
	},
};

export { patchDocument };
