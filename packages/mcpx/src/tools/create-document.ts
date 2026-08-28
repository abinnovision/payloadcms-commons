import { z } from "zod";

import { slugEnum, localeOf, localeShape, readTarget } from "./shared.js";
import { resolveTarget } from "./target.js";
import { errorResult, jsonResult } from "../endpoint/result.js";
import { validateWriteValue } from "../schema/shape.js";
import { defineMcpxTool } from "../types.js";
import { stripRowIds } from "../write/patch.js";
import { collectPublishBlockers } from "../write/publish-blockers.js";

const DESCRIPTION = `Creates a new document as a draft from a minimal seed. Only the fields describeSchema lists may appear in "data"; unknown keys are refused with the valid siblings. The draft may be incomplete: the response lists "publishBlockers", which patchDocument can then work through. Use this when no document exists yet; prefer patching an existing draft otherwise.`;

const createDocument = defineMcpxTool({
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

		// A top-level id is Payload's to assign, never the client's.
		const { id: _ignored, ...seed } = args.data;

		const problems = validateWriteValue(
			payload.config,
			{
				pointer: "",
				resolution: { fields: target.config.flattenedFields, prefix: [] },
			},
			seed,
		);

		if (problems.length > 0) {
			return errorResult("Nothing was created.", { problems });
		}

		const created = (await payload.create({
			collection: args.collection,
			data: stripRowIds(seed) as Record<string, unknown>,
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

		const publishBlockers = await collectPublishBlockers(scope.req, {
			doc: saved,
			entity: target,
		});

		return jsonResult({
			id: saved["id"],
			status: saved["_status"],
			updatedAt: saved["updatedAt"],
			...(publishBlockers.length > 0 ? { publishBlockers } : {}),
		});
	},
});

export { createDocument };
