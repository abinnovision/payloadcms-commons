import {
	blockerFields,
	collectLocaleBlockers,
	documentSummary,
	readDraft,
	resolveDocument,
	staleReadResult,
	updateTarget,
	withRequestLocale,
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
import { isPlainObject, propOf } from "../guards.js";
import { errorResult, jsonResult } from "../result.js";
import { withPublishIntent } from "../write/publish-intent.js";
import { withTransaction } from "../write/transaction.js";

import type { DocumentRef } from "../entity.js";
import type { McpxToolScope } from "../types.js";

const DESCRIPTION = `Makes the current draft of one document or global public. Without "locale", and on a first publish, it covers every locale and is refused while any locale has publish blockers. With "locale" on a published document, only that locale is published and checked; other locales of localized fields stay as last published, and "otherLocaleBlockers" lists what they still lack. Call validateDocument first. "publishedLocales" lists what went live. There is no unpublish. The response links the document with "adminUrl" and "previewUrl".`;

const FIRST_PUBLISH_REFUSED = `Nothing was published. A first publish covers every locale, and some locales have publish blockers or could not be checked. Complete those locales, or publish from the admin panel.`;

const ALL_LOCALES_REFUSED = `Nothing was published, because some locales have publish blockers or could not be checked. Fix them, or pass "locale" to publish one locale.`;

/**
 * Whether any locale of the document is live. Payload 3 keeps one `_status`;
 * Payload 4 keeps one per locale where the entity has localized fields.
 */
const wasPublished = async (
	scope: McpxToolScope,
	target: DocumentRef,
): Promise<boolean> => {
	const { payload } = scope.req;
	const shared = {
		depth: 0,
		draft: false,
		locale: "all",
		overrideAccess: true,
		req: scope.req,
		select: { _status: true as const },
	};

	const doc = await withRequestLocale(scope.req, async () =>
		target.kind === "collection"
			? await payload.findByID({
					...shared,
					collection: target.slug,
					id: target.id,
					disableErrors: true,
				})
			: await payload.findGlobal({ ...shared, slug: target.slug }),
	);
	const status = propOf(doc, "_status");

	return (
		status === "published" ||
		(isPlainObject(status) && Object.values(status).includes("published"))
	);
};

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
		 * Explicit, because Payload's local API assigns `req.locale` in place: a
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
			 * A publish without "locale", and the first publish of a document,
			 * cover every locale. Each locale is checked up front, so both majors
			 * refuse the same drafts.
			 */
			const firstPublish =
				localization !== null && !(await wasPublished(scope, target));
			const everyLocale =
				localization && (args.locale === undefined || firstPublish)
					? localization.locales
					: undefined;

			if (everyLocale) {
				const check = await collectLocaleBlockers(scope, target, everyLocale);

				if (check.blockers.length > 0 || check.unavailable) {
					return errorResult(
						firstPublish ? FIRST_PUBLISH_REFUSED : ALL_LOCALES_REFUSED,
						blockerFields(check, "publishBlockers"),
					);
				}
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
				...(everyLocale
					? { publishAllLocales: true }
					: { publishSpecificLocale: args.locale }),
			});

			const saved = await readDraft(scope, {
				target,
				locale,
				privileged: true,
			});
			const summary = {
				...documentSummary(target, saved),
				...(await documentLinks(scope.req, { target, doc: saved, locale })),
			};

			if (everyLocale) {
				return jsonResult({ ...summary, publishedLocales: everyLocale });
			}

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
				...summary,
				...(locale === undefined ? {} : { publishedLocales: [locale] }),
				...blockerFields(others, "otherLocaleBlockers"),
			});
		});
	},
});
