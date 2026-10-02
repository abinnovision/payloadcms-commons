import { Forbidden, NotFound } from "payload";
import { Pointer } from "rfc6902";
import { z } from "zod";

import {
	identityOf,
	readDraft,
	resolveDocument,
	staleReadResult,
} from "./document.js";
import {
	draftSentence,
	idShape,
	localeOf,
	localeShape,
	entityShape,
	ONE_DOCUMENT_RULE,
} from "./shared.js";
import { defineMcpxTool } from "../define-tool.js";
import { isPlainObject } from "../guards.js";
import { errorResult, jsonResult } from "../result.js";
import { JSON_POINTER_PATTERN } from "../schema/index.js";
import { applyPatchOperations, isElementPointer } from "../write/patch.js";
import { collectPublishBlockers } from "../write/publish-blockers.js";
import { withTransaction } from "../write/transaction.js";
import { buildWriteData } from "../write/write-data.js";

import type { McpxToolScope } from "../types.js";
import type { PatchOperation } from "../write/patch.js";

const DESCRIPTION = (
	scope: McpxToolScope,
): string => `Applies RFC 6902 JSON Patch operations to one document.

${ONE_DOCUMENT_RULE}

${draftSentence(scope)}

Only the fields describeSchema lists can be addressed. A pointer that does not resolve is refused with the fields that are valid at that point, and nothing is applied unless every operation in the batch validates first. describeSchema reports field paths in this same pointer syntax; a path becomes a pointer into a document by replacing each "*" and each block slug with its 0-based index. Inside a rich text field that substitution does not apply: a path there names the node type, and a block node its slug, where a pointer enters the stored state at "root" and walks "children" by an index counted over every child at that level, not over the blocks among them, with the node's own fields under "fields". So "/content/block/practice-note/variant" is written at "/content/root/children/7/fields/variant".

Adding a block requires "blockType" on the value. Append with "/-" as the last segment. To clear a field use "replace" with null; an array or blocks field refuses null and is emptied with [] instead. "remove" is only for list elements, because a field left out of a write is kept rather than cleared. Read the document first to learn the indices, and pass its "updatedAt" as expectedUpdatedAt so an edit made since that read is refused rather than overwritten.

Inside a rich text field a pointer keeps going: "/content/root/children/2" is a node, "/content/root/children/2/tag" one of its properties, and "/content/root/children/2/fields/url" a field it carries. A node written at a position must carry everything Lexical serializes, "version" included, exactly as one written inside a whole state must; getDocument with "outline" returns each node's pointer and version, which is the cheapest way to get both right. A node's "type" cannot be replaced on its own, and neither can the root.

Node positions shift as soon as anything is added or removed, so read immediately before patching, order removals from the last index to the first, and use a "test" operation on "/content/root/children/2/type" to assert a position is what you think it is before writing to it.

A successful write may come back with "publishBlockers": everything still wrong with the draft, such as required fields left empty. Those do not fail the write, because a draft is allowed to be incomplete, but the document cannot be published until the list is empty. "notApplied" lists pointers whose value Payload kept unchanged or cannot be read back, which happens when field-level access denies the update. "publishBlockersUnavailable" means the check itself failed, so the empty list says nothing about whether the document is publishable.`;

const POINTER = z.string().regex(JSON_POINTER_PATTERN);

const PATCHES_LIMIT = 500;

/** Discriminated on `op`, so an operation carries only its own members. */
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

/*
 * Whether the intended value survived the write. The saved document may carry
 * more than was sent: Payload assigns fresh row ids and backfills defaults and
 * nulls on save, so `id` keys are ignored and only the keys the client sent are
 * compared. Null and absent count as equal.
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

/*
 * Pointers whose intended value did not survive the write. Element pointers are
 * skipped because an append pointer (`/-`) does not resolve against the saved
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
 * document before writing anything, runs the write in a transaction, then
 * re-reads the saved document to report which pointers survived and what still
 * blocks publishing. The draft guard, not this tool, decides where the write
 * lands.
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
		...entityShape(scope, "write", {
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
			.max(PATCHES_LIMIT)
			.describe("Operations, applied in order."),
		expectedUpdatedAt: z
			.string()
			.optional()
			.describe(
				"The updatedAt read before patching. Best effort: the write is refused if the document changed before the check, but not if it changes between the check and the write.",
			),
	}),
	handler: async ({ args, scope }) => {
		const target = resolveDocument(scope, args, "write");
		const { payload } = scope.req;
		const locale = localeOf(scope, args.locale);
		/*
		 * `z.unknown()` cannot say "present, any value", so the schema leaves
		 * `value` optional where rfc6902's union requires it. The cast states that
		 * gap once instead of at each use.
		 */
		const patches = args.patches as PatchOperation[];

		return await withTransaction(scope.req, async () => {
			const doc = await readDraft(scope, { target, locale });
			const stale = staleReadResult(
				doc,
				args.expectedUpdatedAt,
				"The document changed since you read it. Read it again and re-apply the patch.",
			);

			if (stale) {
				return stale;
			}

			const applied = applyPatchOperations(payload.config, {
				doc,
				patches,
				ref: target,
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
					id: target.id,
				});
			} else {
				/*
				 * `updateGlobal` passes `fallbackLocale` through to the read it merges
				 * the write onto, and Payload defaults that to the default locale.
				 * Without this, a value missing in the written locale would be
				 * backfilled from another locale and persisted.
				 */
				await payload.updateGlobal({
					...write,
					fallbackLocale: false,
					slug: target.slug,
				});
			}

			const saved = await readDraft(scope, {
				target,
				locale,
				privileged: true,
			});

			/*
			 * `notApplied` compares against what the user can read, so a closed field
			 * answers the same whether or not the guess matched. A patch that leaves
			 * the document unreadable to the user omits it instead of failing the
			 * write.
			 */
			const readable = await readDraft(scope, { target, locale }).catch(
				(error: unknown) => {
					if (error instanceof NotFound || error instanceof Forbidden) {
						return undefined;
					}

					throw error;
				},
			);
			const notApplied = readable
				? notAppliedPointers(patches, applied.next, readable)
				: [];
			const validation = await collectPublishBlockers(scope.req, {
				doc: saved,
				entity: target,
			});

			return jsonResult({
				...identityOf(target, saved["id"]),
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
