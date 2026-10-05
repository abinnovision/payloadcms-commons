import { Forbidden } from "payload";

import { createdResult } from "./create-document.js";
import { resolveEntity } from "./document.js";
import {
	idSchema,
	liveWriteSentence,
	localeOf,
	slugEnum,
	slugsFor,
} from "./shared.js";
import { defineMcpxTool } from "../define-tool.js";
import { withDuplicateIntent } from "../write/publish-intent.js";

import type { DocumentId } from "../entity.js";
import type { McpxToolScope } from "../types.js";

/*
 * Upload collections are left out because Payload copies the file by fetching
 * it, which bypasses the upload grant.
 */
const duplicableSlugs = (scope: McpxToolScope): string[] =>
	slugsFor(scope, "create").collections.filter(
		(slug) =>
			scope.req.payload.config.collections.find(
				(collection) => collection.slug === slug,
			)?.disableDuplicate !== true &&
			!scope.exposure.collections.some(
				(entity) => entity.slug === slug && entity.isUpload,
			),
	);

const DESCRIPTION = (scope: McpxToolScope): string =>
	`Copies a document into a new one in the same collection. Use it instead of getDocument and createDocument to copy a document. It copies the latest version, the draft if there is one, in every locale. Unique text fields get " - Copy" appended. Returns the same fields as createDocument. To rename the copy, call patchDocument with the returned "updatedAt".

${liveWriteSentence(scope, "create")}`;

/**
 * Wraps Payload's duplicate, which checks read access on the source and create
 * access on the copy, and runs the fields' `beforeDuplicate` hooks.
 */
export const duplicateDocument = defineMcpxTool({
	name: "duplicateDocument",
	description: DESCRIPTION,
	annotations: {
		readOnlyHint: false,
		destructiveHint: false,
		idempotentHint: false,
		openWorldHint: false,
	},
	isEnabled: (scope) => duplicableSlugs(scope).length > 0,
	inputSchema: (scope) => ({
		collection: slugEnum(duplicableSlugs(scope)),
		id: idSchema,
	}),
	handler: async ({ args, scope }) => {
		const target = resolveEntity(
			scope,
			{ collection: args.collection },
			"create",
		);

		if (
			target.kind === "global" ||
			!duplicableSlugs(scope).includes(target.slug)
		) {
			throw new Forbidden(scope.req.t);
		}

		const created = (await scope.req.payload.duplicate({
			collection: target.slug,
			id: args.id,
			// Lets the draft guard keep the source id, which it strips otherwise.
			data: withDuplicateIntent({}),
			depth: 0,
			draft: true,
			overrideAccess: false,
			req: scope.req,
		})) as Record<string, unknown>;

		return await createdResult(scope, {
			target,
			id: created["id"] as DocumentId,
			locale: localeOf(scope, undefined),
		});
	},
});
