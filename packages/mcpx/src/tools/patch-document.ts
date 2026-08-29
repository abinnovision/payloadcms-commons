import { Pointer } from "rfc6902";
import { z } from "zod";

import {
	draftSentence,
	idShape,
	localeOf,
	localeShape,
	readTarget,
	sameInstant,
	targetShape,
} from "./shared.js";
import { refOf, requireIdFor, resolveTarget } from "./target.js";
import { errorResult, jsonResult } from "../result.js";
import { defineMcpxTool } from "../types.js";
import {
	applyPatchOperations,
	buildWriteData,
	isElementPointer,
	PATCH_OPERATION_SCHEMA,
} from "../write/patch.js";
import { collectPublishBlockers } from "../write/publish-blockers.js";
import { withTransaction } from "../write/transaction.js";

import type { McpxToolScope } from "../types.js";
import type { PatchOperation } from "../write/patch.js";

const DESCRIPTION = (
	scope: McpxToolScope,
): string => `Applies RFC 6902 JSON Patch operations to one document.

Pass exactly one of "collection" and "global". "id" is required with "collection" and must be omitted with "global", because a global is a singleton.

${draftSentence(scope)}

Only the fields describeSchema lists can be addressed. A pointer that does not resolve is refused with the fields that are valid at that point, and nothing is applied unless every operation in the batch validates first. describeSchema reports field paths in this same pointer syntax; a path becomes a pointer into a document by replacing each "*" and each block slug with its 0-based index.

Adding a block requires "blockType" on the value. Append with "/-" as the last segment. To clear a field use "replace" with null; an array or blocks field refuses null and is emptied with [] instead. "remove" is only for list elements, because a field left out of a write is kept rather than cleared. Read the document first to learn the indices, and pass its "updatedAt" as expectedUpdatedAt so an edit made since that read is refused rather than overwritten.

A successful write may come back with "publishBlockers": everything still wrong with the draft, such as required fields left empty. Those do not fail the write, because a draft is allowed to be incomplete, but the document cannot be published until the list is empty. "notApplied" lists pointers whose value Payload kept unchanged, which happens when field-level access denies the update. "publishBlockersUnavailable" means the check itself failed, so the empty list says nothing about whether the document is publishable.`;

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

/**
 * The handler validates the whole batch against the schema and the current
 * document before it writes anything, runs the write in a transaction, then
 * re-reads the saved document to report which pointers survived and what still
 * blocks publishing. Nothing here decides where the write lands: the draft
 * guard does that on the Payload operation.
 */
export const patchDocument = defineMcpxTool({
	name: "patchDocument",
	description: DESCRIPTION,
	annotations: {
		readOnlyHint: false,
		destructiveHint: true,
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
				"The updatedAt read before patching. Best effort: the write is refused if the document changed before the check, but not if it changes between the check and the write.",
			),
	}),
	handler: async ({ args, scope }) => {
		const target = resolveTarget(scope, args, "write");
		const id = requireIdFor(target, args.id);
		const { payload } = scope.req;
		const locale = localeOf(scope, args.locale);
		/*
		 * `z.unknown()` cannot say "present, any value", so the schema leaves
		 * `value` optional where rfc6902's own union requires it. Narrowing
		 * states that gap once instead of at each use.
		 */
		const patches = args.patches as PatchOperation[];

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

			const applied = applyPatchOperations(payload.config, {
				doc,
				patches,
				ref: refOf(target),
			});

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
				/*
				 * `updateGlobal` passes `fallbackLocale` straight through to the read
				 * it merges the write onto, and Payload defaults that to the default
				 * locale. Without this, a value missing in the written locale would be
				 * backfilled from another one and persisted here.
				 */
				await payload.updateGlobal({
					...write,
					fallbackLocale: false,
					slug: target.slug,
				});
			}

			const saved = await readTarget(scope, {
				target,
				id,
				locale,
				privileged: true,
			});

			const notApplied = notAppliedPointers(patches, applied.next, saved);
			const validation = await collectPublishBlockers(scope.req, {
				doc: saved,
				entity: target,
			});

			return jsonResult({
				...(target.kind === "collection"
					? { id: saved["id"] }
					: { global: target.slug }),
				status: saved["_status"],
				updatedAt: saved["updatedAt"],
				...(validation.blockers.length > 0
					? { publishBlockers: validation.blockers }
					: {}),
				...(validation.unavailable ? { publishBlockersUnavailable: true } : {}),
				...(notApplied.length > 0 ? { notApplied } : {}),
			});
		});
	},
});
