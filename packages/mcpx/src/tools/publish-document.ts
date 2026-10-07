import {
	blockerFields,
	collectLocaleBlockers,
	documentSummary,
	readDraft,
	resolveDocument,
	staleReadResult,
	updateTarget,
} from "./document.js";
import { documentLinks } from "./links.js";
import {
	expectedUpdatedAtShape,
	idShape,
	localeOf,
	localeShape,
	reaches,
	entityShape,
} from "./shared.js";
import { defineMcpxTool } from "../define-tool.js";
import { jsonResult } from "../result.js";
import { withPublishIntent } from "../write/publish-intent.js";
import { withTransaction } from "../write/transaction.js";

const DESCRIPTION = `Makes the current draft of one document or global public, in every locale or only in "locale". A scoped publish keeps the other locales of localized fields as last published, and a never-published document goes live in full. A draft with publish blockers is refused, so call validateDocument first. Payload checks only the published locale, so "otherLocaleBlockers" lists what other locales still lack. There is no unpublish. The response links the document with "adminUrl" and "previewUrl".`;

/**
 * Publishes a draft. Available where the config exposes `publish` on an entity
 * with drafts and the key has both the `write` and `publish` checkboxes.
 */
export const publishDocument = defineMcpxTool({
	name: "publishDocument",
	description: DESCRIPTION,
	annotations: { destructiveHint: true, openWorldHint: false },
	isEnabled: (scope) => reaches(scope, "publish"),
	inputSchema: (scope) => ({
		...entityShape(scope, "publish"),
		...idShape(scope, "publish"),
		...localeShape(scope, { required: false }),
		...expectedUpdatedAtShape,
	}),
	handler: async ({ args, scope }) => {
		const target = resolveDocument(scope, args, "publish");
		/*
		 * Explicit, because `createLocalReq` assigns `req.locale` in place: a
		 * preceding patchDocument leaves its locale on the shared request, and an
		 * argument-free publish would otherwise inherit it.
		 */
		const locale = localeOf(scope, args.locale);
		const { localization } = scope;

		return await withTransaction(scope.req, async () => {
			const doc = await readDraft(scope, { target, locale });
			const stale = staleReadResult(
				doc,
				args.expectedUpdatedAt,
				"The document changed since you read it. Read it again before publishing.",
			);

			if (stale) {
				return stale;
			}

			/*
			 * The marker alone requests the publish, and the draft guard writes
			 * `_status`. Neither goes through `buildWriteData`, which strips
			 * reserved fields and would leave nothing.
			 */
			await updateTarget(scope, target, {
				data: withPublishIntent({}),
				draft: false,
				locale,
				publishSpecificLocale: args.locale,
			});

			const saved = await readDraft(scope, {
				target,
				locale,
				privileged: true,
			});

			/*
			 * Advisory: the publish has landed, so a blocker elsewhere is reported
			 * and never turns it into a failure.
			 */
			const others = await collectLocaleBlockers(
				scope,
				target,
				localization?.locales.filter((entry) => entry !== locale) ?? [],
			);

			return jsonResult({
				...documentSummary(target, saved),
				...(await documentLinks(scope.req, { target, doc: saved, locale })),
				...blockerFields(others, "otherLocaleBlockers"),
			});
		});
	},
});
