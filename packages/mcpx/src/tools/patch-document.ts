import { APIError, Forbidden, NotFound } from "payload";
import { Pointer } from "rfc6902";
import { z } from "zod";

import {
	identityOf,
	readDraft,
	resolveDocument,
	staleReadResult,
} from "./document.js";
import {
	idShape,
	liveWriteSentence,
	localeOf,
	localeShape,
	entityShape,
} from "./shared.js";
import { defineMcpxTool } from "../define-tool.js";
import { isPlainObject } from "../guards.js";
import { errorResult, jsonResult } from "../result.js";
import { JSON_POINTER_PATTERN } from "../schema/index.js";
import {
	assertAcceptsFile,
	fileShape,
	fileSlugs,
	fileWriteRefusal,
	uploadedFile,
	uploadHandoff,
} from "../upload/file.js";
import { applyPatchOperations, isElementPointer } from "../write/patch.js";
import { collectPublishBlockers } from "../write/publish-blockers.js";
import { withTransaction } from "../write/transaction.js";
import { buildWriteData } from "../write/write-data.js";

import type { McpxToolScope } from "../types.js";
import type { PatchOperation } from "../write/patch.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

const DESCRIPTION = (
	scope: McpxToolScope,
): string => `Applies JSON Patch operations to one document or global, e.g. {"op":"replace","path":"/title","value":"Home"}. If any operation fails, nothing is written and the response lists the problems.

${liveWriteSentence(scope, "write")}

Read the document with getDocument right before patching. Append to a list with "/-". A new block needs "blockType". To clear a field, "replace" it with null, or with [] for an array or blocks field. "remove" only removes list elements. Indices shift with every add or remove, so remove from the last index to the first.

In a rich text field a pointer continues into the rich text state: "/content/root/children/2" is a node, "/content/root/children/2/tag" one of its properties and "/content/root/children/3/fields/tone" a field of a block node. getDocument "outline" lists each node's pointer and "version". Build nodes from describeSchema "nodeProperties". Check a position before writing to it, e.g. {"op":"test","path":"/content/root/children/2/type","value":"heading"}.

The response carries "updatedAt" and, if any, "publishBlockers": what must be fixed before publishing. "publishBlockersUnavailable" means that check failed. The write stands either way. "notApplied" lists pointers whose value did not change or cannot be read back, for example where field access denies the update.`;

const POINTER = z.string().regex(JSON_POINTER_PATTERN);

const PATCHES_LIMIT = 500;

/**
 * Discriminated on `op`, so an operation carries only its own members.
 */
export const PATCH_OPERATION_SCHEMA = z.discriminatedUnion("op", [
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
]);

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

/*
 * What the transaction ends with: a finished result, the arguments of a call
 * that waits for its file, or a write whose report is read after the commit.
 */
type Outcome =
	| { done: CallToolResult }
	| { handoff: Record<string, unknown> & { file: object } }
	| { written: Record<string, unknown> };

/**
 * The handler validates the whole batch against the schema and the current
 * document before writing anything, runs the write in a transaction, then
 * re-reads the saved document to report which pointers survived and what still
 * blocks publishing. The draft guard, not this tool, decides where the write
 * lands. With `file`, the patches and the file land as one update, and the
 * transaction commits right after it because Payload has moved files by then.
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
		scope.collections.writable.length + scope.globals.writable.length > 0,
	inputSchema: (scope) => ({
		...entityShape(scope, "write"),
		...idShape(scope, "write"),
		...localeShape(scope, {
			required: true,
			description: "Localized fields are written in this locale only.",
		}),
		patches:
			fileSlugs(scope).length === 0
				? z.array(PATCH_OPERATION_SCHEMA).min(1).max(PATCHES_LIMIT)
				: z
						.array(PATCH_OPERATION_SCHEMA)
						.max(PATCHES_LIMIT)
						.describe('May be empty when "file" is given.'),
		expectedUpdatedAt: z
			.string()
			.optional()
			.describe(
				'"updatedAt" from your last read. Refused if the document changed since.',
			),
		...fileShape(
			scope,
			(slugs) =>
				`Replaces the file of a document in ${slugs}. The call returns an "upload" for the bytes instead of writing.`,
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
		const { file } = args;
		const bytes = uploadedFile(scope.req);

		if (file !== undefined) {
			assertAcceptsFile(scope, target, file);
		}

		if (patches.length === 0 && file === undefined) {
			throw new APIError(
				'"patches" may be empty only when "file" is given.',
				400,
			);
		}

		const report = async (
			next: Record<string, unknown>,
		): Promise<CallToolResult> => {
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
				? notAppliedPointers(patches, next, readable)
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
		};

		const outcome = await withTransaction<Outcome>(scope.req, async () => {
			const doc = await readDraft(scope, { target, locale });
			const stale = staleReadResult(
				doc,
				args.expectedUpdatedAt,
				"The document changed since you read it. Read it again and re-apply the patch.",
			);

			if (stale) {
				return { done: stale };
			}

			const applied = applyPatchOperations(payload.config, {
				doc,
				patches,
				ref: target,
			});

			if ("problems" in applied) {
				return {
					done: errorResult("No operation was applied.", {
						problems: applied.problems,
					}),
				};
			}

			if (file !== undefined && target.kind === "collection") {
				const refusal = await fileWriteRefusal(scope, {
					entity: target,
					id: target.id,
					data: applied.next,
				});

				if (refusal) {
					return { done: refusal };
				}

				// Pinned to the state the call was checked against.
				if (!bytes) {
					return {
						handoff: { ...args, file, expectedUpdatedAt: doc["updatedAt"] },
					};
				}
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
					...(bytes === undefined ? {} : { file: bytes }),
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

			return bytes === undefined
				? { done: await report(applied.next) }
				: { written: applied.next };
		});

		if ("done" in outcome) {
			return outcome.done;
		}

		if ("handoff" in outcome) {
			return await uploadHandoff(scope, {
				tool: "patchDocument",
				args: outcome.handoff,
			});
		}

		return await report(outcome.written);
	},
});
