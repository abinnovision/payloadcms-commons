import { z } from "zod";

import { resolveEntity } from "./document.js";
import { assertQueryable } from "./query-paths.js";
import { mcpxReadRequest } from "./read-request.js";
import {
	slugEnum,
	depthShape,
	localeOf,
	localeShape,
	READ_LOCALE_DESCRIPTION,
} from "./shared.js";
import { defineMcpxTool } from "../define-tool.js";
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
		collection: slugEnum(scope.collections.readable),
		where: z.record(z.string(), z.unknown()).optional(),
		sort: z.string().optional().describe('e.g. "-updatedAt" for descending.'),
		limit: z
			.number()
			.int()
			.min(1)
			.max(scope.limits.maxLimit)
			.optional()
			.describe("Default 10."),
		page: z.number().int().min(1).optional(),
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
		resolveEntity(scope, { collection: args.collection }, "read");

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
			...(args.page === undefined ? {} : { page: args.page }),
			...(args.sort === undefined ? {} : { sort: args.sort }),
			...(args.where === undefined ? {} : { where: args.where as Where }),
			...(args.select === undefined
				? {}
				: { select: args.select as SelectType }),
			...(locale === undefined ? {} : { locale }),
		});

		return jsonResult({
			docs: result.docs.map((doc) =>
				stripAdminHidden(
					scope.req.payload.config,
					{ kind: "collection", slug: args.collection },
					doc,
				),
			),
			totalDocs: result.totalDocs,
			page: result.page,
			totalPages: result.totalPages,
			limit: result.limit,
			hasNextPage: result.hasNextPage,
		});
	},
});
