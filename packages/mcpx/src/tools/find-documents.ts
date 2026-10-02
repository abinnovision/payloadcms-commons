import { z } from "zod";

import { resolveEntity } from "./document.js";
import { readRequest } from "./read-request.js";
import { slugEnum, depthShape, localeOf, localeShape } from "./shared.js";
import { defineMcpxTool } from "../define-tool.js";
import { jsonResult } from "../result.js";

import type { SelectType, Where } from "payload";

const DESCRIPTION = `Finds documents in a collection. "where" is a Payload query object, e.g. {"title":{"contains":"home"}} or {"and":[...]}; "select" picks fields, e.g. {"title":true}. Drafts are included by default so unpublished work is visible. Keep depth at 0 unless populated relationships are needed; ids are enough for writes.`;

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
		collection: slugEnum(scope.collections.readable).describe(
			"Collection to search.",
		),
		where: z
			.record(z.string(), z.unknown())
			.optional()
			.describe("Payload where query."),
		sort: z
			.string()
			.optional()
			.describe('Sort field, prefix with "-" for descending.'),
		limit: z
			.number()
			.int()
			.min(1)
			.max(scope.limits.maxLimit)
			.optional()
			.describe(
				`Documents per page. Default 10, at most ${String(scope.limits.maxLimit)}.`,
			),
		page: z.number().int().min(1).optional().describe("Page number, from 1."),
		...depthShape(scope),
		select: z
			.record(z.string(), z.unknown())
			.optional()
			.describe('Fields to return, e.g. {"title":true}.'),
		...localeShape(scope, {
			required: false,
			description: "Locale to read. Defaults to the default locale.",
		}),
		draft: z
			.boolean()
			.optional()
			.describe("Include the latest drafts. Default true."),
	}),
	handler: async ({ args, scope }) => {
		resolveEntity(scope, { collection: args.collection }, "read");

		const locale = localeOf(scope, args.locale);
		const result = await scope.req.payload.find({
			collection: args.collection,
			depth: args.depth ?? 0,
			draft: args.draft ?? true,
			limit: args.limit ?? 10,
			overrideAccess: false,
			req: readRequest(scope),
			...(args.page === undefined ? {} : { page: args.page }),
			...(args.sort === undefined ? {} : { sort: args.sort }),
			...(args.where === undefined ? {} : { where: args.where as Where }),
			...(args.select === undefined
				? {}
				: { select: args.select as SelectType }),
			...(locale === undefined ? {} : { locale }),
		});

		return jsonResult({
			docs: result.docs,
			totalDocs: result.totalDocs,
			page: result.page,
			totalPages: result.totalPages,
			limit: result.limit,
			hasNextPage: result.hasNextPage,
		});
	},
});
