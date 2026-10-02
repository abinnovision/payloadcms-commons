import { z } from "zod";

import {
	identityOf,
	readDraft,
	resolveDocument,
	staleReadResult,
} from "./document.js";
import { idShape, localeOf, entityShape, ONE_DOCUMENT_RULE } from "./shared.js";
import { defineMcpxTool } from "../define-tool.js";
import { jsonResult } from "../result.js";
import { withPublishIntent } from "../write/publish-intent.js";
import { withTransaction } from "../write/transaction.js";

const DESCRIPTION = `Publishes the current draft, which changes what the public sees. This is the only tool that does; every other write lands as a draft. Call validateDocument first: a document that still has publish blockers is refused, and nothing is written.

${ONE_DOCUMENT_RULE}

The whole document is published, but Payload only validates the locale the publish runs in, so a required field left empty in another locale goes live empty. That is how the admin panel behaves too. Publishing is refused while a human holds the document open in the admin panel, and republishing an unchanged document is accepted but writes another version.

There is no unpublish: reverting to a draft stays a human action in the admin panel.`;

/**
 * The only tool that changes live content, available where the config sets
 * `write: "live"` on a versioned entity and the key has both the `write` and
 * `publish` checkboxes.
 */
export const publishDocument = defineMcpxTool({
	name: "publishDocument",
	description: DESCRIPTION,
	annotations: { destructiveHint: true, openWorldHint: false },
	isEnabled: (scope) =>
		scope.publishable.length + scope.publishableGlobals.length > 0,
	inputSchema: (scope) => ({
		...entityShape(scope, "publish", {
			collection: "Collection holding the document.",
			global: "Global to publish.",
		}),
		...idShape(scope, "publish"),
		expectedUpdatedAt: z
			.string()
			.optional()
			.describe(
				"The updatedAt read before publishing. Best effort: the publish is refused if the document has changed since, but a write landing between the check and the publish is not.",
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
