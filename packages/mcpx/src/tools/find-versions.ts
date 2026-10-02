import { z } from "zod";

import { requireIdFor, resolveEntity } from "./entity.js";
import {
	idShape,
	localeOf,
	localeShape,
	slugsFor,
	entityShape,
} from "./shared.js";
import { queryVersions } from "./versions.js";
import { defineMcpxTool } from "../define-tool.js";
import { jsonResult } from "../result.js";

const DESCRIPTION = `Lists the version history of one document or global, newest first. Returns metadata only; read a version's body with getDocument and "versionId", or what changed with "diffFrom".

Pass exactly one of "collection" and "global". "id" is required with "collection" and must be omitted with "global". Autosave versions are listed too, marked "autosave".`;

/**
 * Bodies are left out so a long history stays small; `getDocument` reads one
 * when it is needed. The document's `read` access is checked first, then
 * Payload's `readVersions`.
 */
export const findVersions = defineMcpxTool({
	name: "findVersions",
	description: DESCRIPTION,
	annotations: { readOnlyHint: true, openWorldHint: false },
	isEnabled: (scope) => {
		const { collections, globals } = slugsFor(scope, "versions");

		return collections.length + globals.length > 0;
	},
	inputSchema: (scope) => ({
		...entityShape(scope, "versions", {
			collection: "Collection holding the document.",
			global: "Global whose history to list.",
		}),
		...idShape(scope, "versions"),
		limit: z
			.number()
			.int()
			.min(1)
			.max(scope.limits.maxLimit)
			.optional()
			.describe(
				`Versions per page. Default 10, at most ${String(scope.limits.maxLimit)}.`,
			),
		page: z.number().int().min(1).optional().describe("Page number, from 1."),
		status: z
			.enum(["published", "draft"])
			.optional()
			.describe("Only versions with this status."),
		...localeShape(scope, {
			required: false,
			description:
				"Locale whose status to report. Defaults to the default locale.",
		}),
	}),
	handler: async ({ args, scope }) => {
		const target = resolveEntity(scope, args, "versions");
		const id = requireIdFor(target, args.id);

		const result = await queryVersions(
			scope,
			{ target, id, depth: 0, locale: localeOf(scope, args.locale) },
			{
				limit: args.limit ?? 10,
				...(args.page === undefined ? {} : { page: args.page }),
				...(args.status === undefined ? {} : { status: args.status }),
			},
		);

		const versions = result.docs.map((doc) => ({
			versionId: doc.id,
			createdAt: doc["createdAt"],
			updatedAt: doc["updatedAt"],
			status: doc.version["_status"] ?? null,
			latest: doc["latest"] === true,
			autosave: doc["autosave"] === true,
			...(doc["publishedLocale"]
				? { publishedLocale: doc["publishedLocale"] }
				: {}),
		}));

		return jsonResult({
			versions,
			totalDocs: result.totalDocs,
			page: result.page,
			totalPages: result.totalPages,
			hasNextPage: result.hasNextPage,
		});
	},
});
