import { z } from "zod";

import {
	collectionEnum,
	ensureAllowed,
	localeOf,
	localeShape,
	readDraft,
} from "./shared.js";
import { errorResult, jsonResult } from "../endpoint/result.js";
import { validateWriteValue } from "../schema/shape.js";
import { stripRowIds } from "../write/patch.js";
import { collectPublishBlockers } from "../write/publish-blockers.js";

import type { BuiltinTool } from "./types.js";

const DESCRIPTION = `Creates a new document as a draft from a minimal seed. Only the fields describeSchema lists may appear in "data"; unknown keys are refused with the valid siblings. The draft may be incomplete: the response lists "publishBlockers", which patchDocument can then work through. Use this when no document exists yet; prefer patching an existing draft otherwise.`;

interface Args {
	collection: string;
	data: Record<string, unknown>;
	locale?: string;
}

const createDocument: BuiltinTool<Args> = {
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
		collection: collectionEnum(scope.writable).describe(
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
	handler: async (args, scope) => {
		const collection = ensureAllowed(scope, args.collection, "write");
		const { payload } = scope.req;
		const locale = localeOf(scope, args.locale);

		// A top-level id is Payload's to assign, never the client's.
		const { id: _ignored, ...seed } = args.data;

		const problems = validateWriteValue(
			payload.config,
			{
				pointer: "",
				resolution: { fields: collection.flattenedFields, prefix: [] },
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

		const saved = await readDraft(scope, {
			collection: args.collection,
			id: created["id"] as number | string,
			locale,
			privileged: true,
		});

		const publishBlockers = await collectPublishBlockers(scope.req, {
			collection,
			doc: saved,
		});

		return jsonResult({
			id: saved["id"],
			status: saved["_status"],
			updatedAt: saved["updatedAt"],
			...(publishBlockers.length > 0 ? { publishBlockers } : {}),
		});
	},
};

export { createDocument };
