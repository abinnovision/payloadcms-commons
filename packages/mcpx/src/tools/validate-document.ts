import {
	idShape,
	localeOf,
	localeShape,
	readTarget,
	targetShape,
} from "./shared.js";
import { requireIdFor, resolveTarget } from "./target.js";
import { jsonResult } from "../endpoint/result.js";
import { defineMcpxTool } from "../types.js";
import { collectPublishBlockers } from "../write/publish-blockers.js";

const DESCRIPTION = `Reports what still prevents a human from publishing the draft, without writing anything. The same list patchDocument returns after a write; use it to check work or to answer "is this ready".

Pass exactly one of "collection" and "global". "id" is required with "collection" and must be omitted with "global", because a global is a singleton.`;

const validateDocument = defineMcpxTool({
	name: "validateDocument",
	description: DESCRIPTION,
	annotations: { readOnlyHint: true, openWorldHint: false },
	isEnabled: (scope) =>
		scope.writable.length + scope.writableGlobals.length > 0,
	inputSchema: (scope) => ({
		...targetShape(scope, "write", {
			collection: "Collection holding the document.",
			global: "Global to validate.",
		}),
		...idShape(scope, "write"),
		...localeShape(scope, {
			required: true,
			description: "Locale to validate.",
		}),
	}),
	handler: async ({ args, scope }) => {
		const target = resolveTarget(scope, args, "write");
		const id = requireIdFor(target, args.id);
		const locale = localeOf(scope, args.locale);

		// The first read checks the key's access; the second sees every field.
		await readTarget(scope, { target, id, locale });

		const doc = await readTarget(scope, {
			target,
			id,
			locale,
			privileged: true,
		});

		const publishBlockers = await collectPublishBlockers(scope.req, {
			doc,
			entity: target,
		});

		return jsonResult({
			...(target.kind === "collection"
				? { id: doc["id"] }
				: { global: target.slug }),
			status: doc["_status"],
			updatedAt: doc["updatedAt"],
			publishBlockers,
		});
	},
});

export { validateDocument };
