import { APIError } from "payload";
import { hasDraftsEnabled } from "payload/shared";
import { z } from "zod";

import { resolveDocument } from "./document.js";
import {
	idShape,
	localeOf,
	localeShape,
	pageFields,
	pageShape,
	reaches,
	slugsFor,
	slugsWhere,
	entityShape,
	widen,
} from "./shared.js";
import { queryVersions } from "./versions.js";
import { defineMcpxTool } from "../define-tool.js";
import { definedProps } from "../guards.js";
import { jsonResult } from "../result.js";

import type { McpxToolScope } from "../types.js";

const DESCRIPTION = `Lists the versions of one document or global, newest first, autosaves included. Returns per version "versionId", "createdAt", "updatedAt", "status", "latest", "autosave" and, where set, "publishedLocale", without the content. Read a version with getDocument "versionId", or compare it with "diffFrom".`;

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
type StatusShape = {
	status: z.ZodOptional<z.ZodEnum<{ published: "published"; draft: "draft" }>>;
};

/*
 * Only an entity with drafts has `_status` on its versions, so a key that
 * reaches none never sees the argument.
 */
const statusShape = (scope: McpxToolScope): StatusShape => {
	const { collections, globals } = slugsWhere(
		scope,
		(entity) => entity.hasDrafts,
		slugsFor(scope, "versions"),
	);

	if (collections.length + globals.length === 0) {
		return widen<StatusShape>({});
	}

	return widen<StatusShape>({
		status: z.enum(["published", "draft"]).optional(),
	});
};

/**
 * Bodies are left out so a long history stays small; `getDocument` reads one
 * when it is needed. The document's `read` access is checked first, then
 * Payload's `readVersions`. Only entities that keep Payload versions are
 * reachable.
 */
export const findVersions = defineMcpxTool({
	name: "findVersions",
	description: DESCRIPTION,
	annotations: { readOnlyHint: true, openWorldHint: false },
	isEnabled: (scope) => reaches(scope, "versions"),
	inputSchema: (scope) => ({
		...entityShape(scope, "versions"),
		...idShape(scope, "versions"),
		...pageShape(scope),
		...statusShape(scope),
		...localeShape(scope, {
			required: false,
			description:
				'Locale whose "status" is reported. Defaults to the default locale.',
		}),
	}),
	handler: async ({ args, scope }) => {
		const target = resolveDocument(scope, args, "versions");

		if (args.status !== undefined && !hasDraftsEnabled(target.config)) {
			throw new APIError(
				`"${target.slug}" has no drafts, so its versions carry no status.`,
				400,
			);
		}

		const result = await queryVersions(
			scope,
			{ target, depth: 0, locale: localeOf(scope, args.locale) },
			{
				limit: args.limit ?? 10,
				...definedProps({ page: args.page, status: args.status }),
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
			...pageFields(result),
		});
	},
});
