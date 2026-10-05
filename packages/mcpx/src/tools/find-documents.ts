import { z } from "zod";

import { resolveCollection } from "./document.js";
import { assertQueryable } from "./query-paths.js";
import { mcpxReadRequest } from "./read-request.js";
import {
	stringEnum,
	depthShape,
	localeOf,
	localeShape,
	pageFields,
	pageShape,
	READ_LOCALE_DESCRIPTION,
} from "./shared.js";
import { defineMcpxTool } from "../define-tool.js";
import { definedProps } from "../guards.js";
import { jsonResult } from "../result.js";
import { stripAdminHidden } from "../schema/index.js";

import type { SelectType, Where } from "payload";

const DESCRIPTION = `Finds documents in a collection. Returns one page of "docs" with paging totals. "where" is a Payload query, e.g. {"title":{"contains":"home"}}, with dots for nested fields, e.g. "items.heading". A "where" or "sort" on a hidden field, or through a relationship into a collection this key cannot read, is refused.`;

/**
 * Collection-only: a global is a singleton, so there is nothing to list.
 *
 * The query uses `overrideAccess: false`, so the collection's own access
 * control decides what comes back. The schema bounds `limit` and `depth` by the
 * configured limits, so the client sees the ceiling instead of being clamped
 * silently.
 */
export const findDocuments = defineMcpxTool({
	name: "findDocuments",
	description: DESCRIPTION,
	annotations: { readOnlyHint: true, openWorldHint: false },
	isEnabled: (scope) => scope.collections.readable.length > 0,
	inputSchema: (scope) => ({
		collection: stringEnum(scope.collections.readable),
		where: z.record(z.string(), z.unknown()).optional(),
		sort: z.string().optional().describe('e.g. "-updatedAt" for descending.'),
		...pageShape(scope),
		...depthShape(scope),
		select: z
			.record(z.string(), z.unknown())
			.optional()
			.describe('Fields to return, e.g. {"title":true}.'),
		...localeShape(scope, {
			required: false,
			description: READ_LOCALE_DESCRIPTION,
		}),
		draft: z.boolean().optional().describe("Default true: latest drafts."),
	}),
	handler: async ({ args, scope }) => {
		const target = resolveCollection(scope, args.collection, "read");

		const locale = localeOf(scope, args.locale);

		assertQueryable(scope, {
			collection: args.collection,
			where: args.where,
			sort: args.sort,
			locale,
		});

		const result = await scope.req.payload.find({
			collection: args.collection,
			depth: args.depth ?? 0,
			draft: args.draft ?? true,
			limit: args.limit ?? 10,
			overrideAccess: false,
			req: mcpxReadRequest(scope),
			...definedProps({
				page: args.page,
				sort: args.sort,
				where: args.where as Where | undefined,
				select: args.select as SelectType | undefined,
				locale,
			}),
		});

		return jsonResult({
			docs: result.docs.map((doc) =>
				stripAdminHidden(scope.req.payload.config, target, doc),
			),
			...pageFields(result),
		});
	},
});
