import { z } from "zod";

import {
	identityOf,
	readDraft,
	resolveDocument,
	staleReadResult,
} from "./document.js";
import { idShape, localeOf, entityShape } from "./shared.js";
import { defineMcpxTool } from "../define-tool.js";
import { jsonResult } from "../result.js";
import { withPublishIntent } from "../write/publish-intent.js";
import { withTransaction } from "../write/transaction.js";

const DESCRIPTION = `Makes the current draft of one document or global public. A draft with publish blockers is refused, so call validateDocument first. Publishing validates one locale only, normally the default, so a required field left empty in another locale goes live empty. Run validateDocument for each locale. There is no unpublish. A person takes content offline in the admin panel.`;

/**
 * Publishes a draft. Available where the config exposes `publish` on an entity
 * with drafts and the key has both the `write` and `publish` checkboxes.
 */
export const publishDocument = defineMcpxTool({
	name: "publishDocument",
	description: DESCRIPTION,
	annotations: { destructiveHint: true, openWorldHint: false },
	isEnabled: (scope) =>
		scope.collections.publishable.length + scope.globals.publishable.length > 0,
	inputSchema: (scope) => ({
		...entityShape(scope, "publish"),
		...idShape(scope, "publish"),
		expectedUpdatedAt: z
			.string()
			.optional()
			.describe(
				'"updatedAt" from your last read. Refused if the document changed since.',
			),
	}),
	handler: async ({ args, scope }) => {
		const target = resolveDocument(scope, args, "publish");
		const { payload } = scope.req;
		/*
		 * Explicit, because `createLocalReq` assigns `req.locale` in place: a
		 * preceding patchDocument leaves its locale on the shared request, and an
		 * argument-free publish would otherwise inherit it.
		 */
		const locale = localeOf(scope, undefined);

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
			const write = {
				data: withPublishIntent({}),
				depth: 0,
				draft: false,
				fallbackLocale: false as const,
				overrideAccess: false,
				req: scope.req,
				...(locale === undefined ? {} : { locale }),
			};

			if (target.kind === "collection") {
				await payload.update({
					...write,
					collection: target.slug,
					id: target.id,
				});
			} else {
				await payload.updateGlobal({ ...write, slug: target.slug });
			}

			const saved = await readDraft(scope, {
				target,
				locale,
				privileged: true,
			});

			return jsonResult({
				...identityOf(target, saved["id"]),
				status: saved["_status"],
				updatedAt: saved["updatedAt"],
			});
		});
	},
});
