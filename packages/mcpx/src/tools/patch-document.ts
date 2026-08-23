import { Pointer } from "rfc6902";
import { z } from "zod";

import {
	collectionEnum,
	ensureAllowed,
	idSchema,
	localeOf,
	localeShape,
	readDraft,
} from "./shared.js";
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

The write always lands as a draft and is never published, whatever it contains; publishing stays a human action in the admin panel.

Only the fields describeSchema lists can be addressed. A pointer that does not resolve is refused with the fields that are valid at that point, and nothing is applied unless every operation in the batch validates first. Use describeSchema to find a field's path, then turn it into a pointer by replacing "." with "/" and each "[]" with a 0-based index.

Adding a block requires "blockType" on the value. Append with "/-" as the last segment. To clear a field use "replace" with null, or with [] to empty a list; "remove" is only for list elements, because a field left out of a write is kept rather than cleared. Read the document first to learn the indices, and pass its "updatedAt" as expectedUpdatedAt so a concurrent edit is refused rather than overwritten.

A successful write may come back with "publishBlockers": everything still wrong with the draft, such as required fields left empty. Those do not fail the write, because a draft is allowed to be incomplete, but a human cannot publish the document until the list is empty. "notApplied" lists pointers whose value Payload kept unchanged, which happens when field-level access denies the update.`;

interface Args {
	collection: string;
	expectedUpdatedAt?: string;
	id: number | string;
	locale?: string;
	patches: PatchOperation[];
}

const sameInstant = (left: unknown, right: string): boolean =>
	typeof left === "string" &&
	new Date(left).getTime() === new Date(right).getTime();

const normalize = (value: unknown): string =>
	JSON.stringify(value === undefined ? null : value);

/**
 * Pointers whose intended value did not survive the write. Only field
 * pointers are compared: rows get fresh ids on write, so element pointers
 * cannot be compared byte for byte.
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

		return normalize(expected) === normalize(actual) ? [] : [operation.path];
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
	isEnabled: (scope) => scope.writable.length > 0,
	inputSchema: (scope) => ({
		collection: collectionEnum(scope.writable).describe(
			"Collection holding the document.",
		),
		id: idSchema,
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
		const collection = ensureAllowed(scope, args.collection, "write");
		const { payload } = scope.req;
		const locale = localeOf(scope, args.locale);

		return await withTransaction(scope.req, async () => {
			const doc = await readDraft(scope, {
				collection: args.collection,
				id: args.id,
				locale,
			});

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
				collection: args.collection,
				doc,
				patches: args.patches,
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

			await payload.update({
				collection: args.collection,
				id: args.id,
				data: buildWriteData(payload.config, collection, applied.next),
				depth: 0,
				draft: true,
				overrideAccess: false,
				req: scope.req,
				...(locale === undefined ? {} : { locale }),
			});

			const saved = await readDraft(scope, {
				collection: args.collection,
				id: args.id,
				locale,
				privileged: true,
			});

			const notApplied = notAppliedPointers(args.patches, applied.next, saved);
			const publishBlockers = await collectPublishBlockers(scope.req, {
				collection,
				doc: saved,
			});

			return jsonResult({
				id: saved["id"],
				status: saved["_status"],
				updatedAt: saved["updatedAt"],
				...(publishBlockers.length > 0 ? { publishBlockers } : {}),
				...(notApplied.length > 0 ? { notApplied } : {}),
			});
		});
	},
};

export { patchDocument };
