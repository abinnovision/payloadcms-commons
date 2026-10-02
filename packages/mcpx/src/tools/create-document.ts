import { z } from "zod";

import { readDraft, resolveEntity } from "./entity.js";
import {
	draftSentence,
	localeOf,
	localeShape,
	patchOnlySlugs,
	slugEnum,
	slugsFor,
} from "./shared.js";
import { defineMcpxTool } from "../define-tool.js";
import { errorResult, jsonResult } from "../result.js";
import { validateWriteValue } from "../schema/index.js";
import { collectPublishBlockers } from "../write/publish-blockers.js";
import { stripRowIds } from "../write/row-ids.js";

import type { DocumentId, DocumentRef } from "../entity.js";
import type { McpxToolScope } from "../types.js";

// Names the writable slugs this tool leaves out, so the gap reads as intent.
const uploadSentence = (scope: McpxToolScope): string => {
	const slugs = patchOnlySlugs(scope);

	return slugs.length === 0
		? ""
		: `\n\nLeft out of "collection" on purpose: ${slugs.join(", ")}. Those documents are files, and no tool here carries one. Upload the file in the admin panel, then edit its fields with patchDocument.`;
};

const DESCRIPTION = (scope: McpxToolScope): string =>
	`Creates a new document from a minimal seed. Only the fields describeSchema lists may appear in "data"; unknown keys are refused with the valid siblings, and "id" is Payload's to assign. The document may be incomplete: the response lists "publishBlockers", which patchDocument can then work through, and "publishBlockersUnavailable" when that check itself failed. Use this when no document exists yet; prefer patching an existing draft otherwise.

${draftSentence(scope)}${uploadSentence(scope)}`;

/**
 * Collection-only, because a global always exists. Upload collections are
 * excluded because a create there would need the file.
 *
 * The seed is checked against the collection's fields first, so an unknown key
 * is refused along with its valid siblings. Row ids in the seed are stripped
 * and a top-level `id` is refused. The new document is re-read privileged to
 * collect publish blockers, so an incomplete seed still succeeds and returns a
 * checklist.
 */
export const createDocument = defineMcpxTool({
	name: "createDocument",
	description: DESCRIPTION,
	annotations: {
		readOnlyHint: false,
		destructiveHint: false,
		idempotentHint: false,
		openWorldHint: false,
	},
	isEnabled: (scope) => slugsFor(scope, "create").collections.length > 0,
	inputSchema: (scope) => ({
		collection: slugEnum(slugsFor(scope, "create").collections).describe(
			"Collection to create the document in.",
		),
		...localeShape(scope, {
			required: true,
			description: "Locale the localized fields of the seed belong to.",
		}),
		data: z
			.record(z.string(), z.unknown())
			.describe("Initial field values, as describeSchema lists them."),
	}),
	handler: async ({ args, scope }) => {
		const target = resolveEntity(
			scope,
			{ collection: args.collection },
			"create",
		);
		const { payload } = scope.req;
		const locale = localeOf(scope, args.locale);

		/*
		 * A top-level id is Payload's to assign. The shape walker accepts `id` at
		 * every level, for row ids a client echoes back, so a supplied one is
		 * refused here instead of silently dropped.
		 */
		if ("id" in args.data) {
			return errorResult("Nothing was created.", {
				problems: ["/id: Payload assigns the id; it cannot be supplied."],
			});
		}

		const problems = validateWriteValue(
			payload.config,
			{
				pointer: "",
				resolution: { fields: target.config.flattenedFields, prefix: [] },
			},
			args.data,
		);

		if (problems.length > 0) {
			return errorResult("Nothing was created.", { problems });
		}

		const created = (await payload.create({
			collection: args.collection,
			data: stripRowIds(args.data) as Record<string, unknown>,
			depth: 0,
			draft: true,
			overrideAccess: false,
			req: scope.req,
			...(locale === undefined ? {} : { locale }),
		})) as Record<string, unknown>;

		const createdRef: DocumentRef =
			target.kind === "collection"
				? { ...target, id: created["id"] as DocumentId }
				: target;
		const saved = await readDraft(scope, {
			target: createdRef,
			locale,
			privileged: true,
		});

		const validation = await collectPublishBlockers(scope.req, {
			doc: saved,
			entity: target,
		});

		return jsonResult({
			id: saved["id"],
			status: saved["_status"],
			updatedAt: saved["updatedAt"],
			...(validation.blockers.length > 0
				? { publishBlockers: validation.blockers }
				: {}),
			...(validation.unavailable ? { publishBlockersUnavailable: true } : {}),
		});
	},
});
