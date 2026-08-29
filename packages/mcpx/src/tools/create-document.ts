import { z } from "zod";

import {
	draftSentence,
	localeOf,
	localeShape,
	readTarget,
	slugEnum,
} from "./shared.js";
import { resolveTarget } from "./target.js";
import { errorResult, jsonResult } from "../result.js";
import { validateWriteValue } from "../schema/index.js";
import { defineMcpxTool } from "../types.js";
import { stripRowIds } from "../write/patch.js";
import { collectPublishBlockers } from "../write/publish-blockers.js";

import type { McpxToolScope } from "../types.js";

const DESCRIPTION = (scope: McpxToolScope): string =>
	`Creates a new document from a minimal seed. Only the fields describeSchema lists may appear in "data"; unknown keys are refused with the valid siblings, and "id" is Payload's to assign. The document may be incomplete: the response lists "publishBlockers", which patchDocument can then work through, and "publishBlockersUnavailable" when that check itself failed. Use this when no document exists yet; prefer patching an existing draft otherwise.

${draftSentence(scope)}`;

export const createDocument = defineMcpxTool({
	name: "createDocument",
	description: DESCRIPTION,
	annotations: {
		readOnlyHint: false,
		destructiveHint: false,
		idempotentHint: false,
		openWorldHint: false,
	},
	isEnabled: (scope) => scope.writable.length > 0,
	inputSchema: (scope) => ({
		collection: slugEnum(scope.writable).describe(
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
		const target = resolveTarget(
			scope,
			{ collection: args.collection },
			"write",
		);
		const { payload } = scope.req;
		const locale = localeOf(scope, args.locale);

		/*
		 * A top-level id is Payload's to assign. The shape walker tolerates `id`
		 * at every level, for the row ids a client echoes back, so a supplied one
		 * is refused here rather than dropped in silence.
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

		const saved = await readTarget(scope, {
			target,
			id: created["id"] as number | string,
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
