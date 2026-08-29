import { z } from "zod";

import {
	idShape,
	localeOf,
	readTarget,
	sameInstant,
	targetShape,
} from "./shared.js";
import { requireIdFor, resolveTarget } from "./target.js";
import { errorResult, jsonResult } from "../result.js";
import { defineMcpxTool } from "../types.js";
import { withPublishIntent } from "../write/publish-intent.js";
import { withTransaction } from "../write/transaction.js";

const DESCRIPTION = `Publishes the current draft, which changes what the public sees. This is the only tool that does; every other write lands as a draft. Call validateDocument first: a document that still has publish blockers is refused, and nothing is written.

Pass exactly one of "collection" and "global". "id" is required with "collection" and must be omitted with "global", because a global is a singleton.

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
		...targetShape(scope, "publish", {
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
		const target = resolveTarget(scope, args, "publish");
		const id = requireIdFor(target, args.id);
		const { payload } = scope.req;
		/*
		 * Explicit, because `createLocalReq` assigns `req.locale` in place: a
		 * preceding patchDocument leaves its locale on the shared request, and an
		 * argument-free publish would otherwise inherit it.
		 */
		const locale = localeOf(scope, undefined);

		return await withTransaction(scope.req, async () => {
			const doc = await readTarget(scope, { target, id, locale });

			if (
				args.expectedUpdatedAt !== undefined &&
				!sameInstant(doc["updatedAt"], args.expectedUpdatedAt)
			) {
				return errorResult(
					"The document changed since you read it. Read it again before publishing.",
					{ updatedAt: doc["updatedAt"] },
				);
			}

			/*
			 * The marker is the whole request to publish; `_status` is written by
			 * the draft guard, which is the only thing that may grant it. Neither
			 * goes through `buildWriteData`, which strips reserved fields and would
			 * leave nothing behind.
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
					id: id as number | string,
				});
			} else {
				await payload.updateGlobal({ ...write, slug: target.slug });
			}

			const saved = await readTarget(scope, {
				target,
				id,
				locale,
				privileged: true,
			});

			return jsonResult({
				...(target.kind === "collection"
					? { id: saved["id"] }
					: { global: target.slug }),
				status: saved["_status"],
				updatedAt: saved["updatedAt"],
			});
		});
	},
});
