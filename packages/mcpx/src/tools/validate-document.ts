import {
	collectionEnum,
	ensureAllowed,
	idSchema,
	localeOf,
	localeShape,
	readDraft,
} from "./shared.js";
import { jsonResult } from "../endpoint/result.js";
import { collectPublishBlockers } from "../write/publish-blockers.js";

import type { BuiltinTool } from "./types.js";

const DESCRIPTION = `Reports what still prevents a human from publishing the draft, without writing anything. The same list patchDocument returns after a write; use it to check work or to answer "is this ready".`;

interface Args {
	collection: string;
	id: number | string;
	locale?: string;
}

const validateDocument: BuiltinTool<Args> = {
	name: "validateDocument",
	description: DESCRIPTION,
	annotations: { readOnlyHint: true, openWorldHint: false },
	isEnabled: (scope) => scope.writable.length > 0,
	inputSchema: (scope) => ({
		collection: collectionEnum(scope.writable).describe(
			"Collection holding the document.",
		),
		id: idSchema,
		...localeShape(scope, {
			required: true,
			description: "Locale to validate.",
		}),
	}),
	handler: async (args, scope) => {
		const collection = ensureAllowed(scope, args.collection, "write");
		const locale = localeOf(scope, args.locale);

		// The first read checks the key's access; the second sees every field.
		await readDraft(scope, {
			collection: args.collection,
			id: args.id,
			locale,
		});

		const doc = await readDraft(scope, {
			collection: args.collection,
			id: args.id,
			locale,
			privileged: true,
		});

		const publishBlockers = await collectPublishBlockers(scope.req, {
			collection,
			doc,
		});

		return jsonResult({
			id: doc["id"],
			status: doc["_status"],
			updatedAt: doc["updatedAt"],
			publishBlockers,
		});
	},
};

export { validateDocument };
