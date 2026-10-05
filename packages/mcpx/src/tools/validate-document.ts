import {
	collectLocaleBlockers,
	documentSummary,
	readDraft,
	resolveDocument,
} from "./document.js";
import {
	idShape,
	localeOf,
	localeShape,
	reaches,
	entityShape,
} from "./shared.js";
import { defineMcpxTool } from "../define-tool.js";
import { jsonResult } from "../result.js";
import { collectPublishBlockers } from "../write/publish-blockers.js";

const DESCRIPTION = `Lists what still blocks publishing one document or global, without saving. Checks one locale when "locale" is given, otherwise every locale. Returns "publishBlockers", each with a pointer and a message, and a "locale" when every locale was checked. An empty list means it can be published, unless "publishBlockersUnavailable" is true: then the check itself failed. The check runs the field hooks a save runs.`;

/**
 * Gated on write, which implies read, because publish blockers only mean
 * something to a caller who can act on them.
 *
 * It reads the document twice on purpose: once under the key's own access to
 * refuse a caller who may not see it, then privileged, so the check covers every
 * field and not only those the user can read. It has no `readOnlyHint` because
 * the traversal fires field hooks.
 */
export const validateDocument = defineMcpxTool({
	name: "validateDocument",
	description: DESCRIPTION,
	annotations: { openWorldHint: false },
	isEnabled: (scope) => reaches(scope, "write"),
	inputSchema: (scope) => ({
		...entityShape(scope, "write"),
		...idShape(scope, "write"),
		...localeShape(scope, { required: false }),
	}),
	handler: async ({ args, scope }) => {
		const target = resolveDocument(scope, args, "write");
		const { localization } = scope;
		const locale = localeOf(scope, args.locale);

		// The first read checks the key's access; the second sees every field.
		await readDraft(scope, { target, locale });

		const doc = await readDraft(scope, {
			target,
			locale,
			privileged: true,
		});

		const validation =
			localization && args.locale === undefined
				? await collectLocaleBlockers(scope, target, localization.locales)
				: await collectPublishBlockers(scope.req, { doc, entity: target });

		return jsonResult({
			...documentSummary(target, doc),
			publishBlockers: validation.blockers,
			...(validation.unavailable ? { publishBlockersUnavailable: true } : {}),
		});
	},
});
