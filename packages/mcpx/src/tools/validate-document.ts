import { readDraft, requireIdFor, resolveEntity } from "./entity.js";
import { idShape, localeOf, localeShape, entityShape } from "./shared.js";
import { defineMcpxTool } from "../define-tool.js";
import { jsonResult } from "../result.js";
import { collectPublishBlockers } from "../write/publish-blockers.js";

const DESCRIPTION = `Reports what still prevents a human from publishing the draft, without writing anything. The same list patchDocument returns after a write; use it to check work or to answer "is this ready".

Pass exactly one of "collection" and "global". "id" is required with "collection" and must be omitted with "global", because a global is a singleton.

Nothing is written, but the check runs the same field-level beforeValidate and beforeChange hooks a save would, so a hook with side effects fires. "publishBlockersUnavailable" means the check itself failed, so the empty list says nothing.`;

/**
 * Gated on write rather than read, because publish blockers only mean
 * something to a caller who can act on them.
 *
 * It reads the document twice on purpose: once under the key's own access to
 * refuse a caller who may not see it, then privileged, so the check runs over
 * every field rather than the subset the user can read. It carries no
 * `readOnlyHint`, because the traversal fires field hooks.
 */
export const validateDocument = defineMcpxTool({
	name: "validateDocument",
	description: DESCRIPTION,
	annotations: { openWorldHint: false },
	isEnabled: (scope) =>
		scope.writable.length + scope.writableGlobals.length > 0,
	inputSchema: (scope) => ({
		...entityShape(scope, "write", {
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
		const target = resolveEntity(scope, args, "write");
		const id = requireIdFor(target, args.id);
		const locale = localeOf(scope, args.locale);

		// The first read checks the key's access; the second sees every field.
		await readDraft(scope, { target, id, locale });

		const doc = await readDraft(scope, {
			target,
			id,
			locale,
			privileged: true,
		});

		const validation = await collectPublishBlockers(scope.req, {
			doc,
			entity: target,
		});

		return jsonResult({
			...(target.kind === "collection"
				? { id: doc["id"] }
				: { global: target.slug }),
			status: doc["_status"],
			updatedAt: doc["updatedAt"],
			publishBlockers: validation.blockers,
			...(validation.unavailable ? { publishBlockersUnavailable: true } : {}),
		});
	},
});
