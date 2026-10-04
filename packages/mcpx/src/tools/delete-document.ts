import { combineQueries, executeAccess, Forbidden, NotFound } from "payload";
import { formatAdminURL } from "payload/shared";
import { z } from "zod";

import { resolveDocument, staleReadResult } from "./document.js";
import { entityShape, idShape, slugsFor } from "./shared.js";
import { defineMcpxTool } from "../define-tool.js";
import { translateStatic } from "../i18n.js";
import { errorResult, jsonResult } from "../result.js";
import { withTrashIntent } from "../write/publish-intent.js";
import { withTransaction } from "../write/transaction.js";

import type { DocumentRef } from "../entity.js";
import type { McpxToolConfirm, McpxToolScope } from "../types.js";
import type { PayloadRequest, Where } from "payload";

type CollectionRef = Extract<DocumentRef, { kind: "collection" }>;

const DESCRIPTION = `Asks to delete one document. This call deletes nothing: it returns a "confirmation" with an "id" and a "url". Give the url to the user, who approves or rejects in the admin panel, then pass the id to runConfirmed, which deletes. Refused when the document is unknown, already in trash, changed since "expectedUpdatedAt" or not deletable by the user.`;

// Names the collections whose deletes cannot be undone.
const permanenceSentence = (scope: McpxToolScope): string => {
	const permanent = slugsFor(scope, "delete").collections.filter(
		(slug) => scope.req.payload.collections[slug]?.config.trash !== true,
	);

	if (permanent.length === 0) {
		return " Documents move to trash.";
	}

	const sentence = ` Deletes in ${permanent.join(", ")} are permanent.`;

	return permanent.length === slugsFor(scope, "delete").collections.length
		? sentence
		: `${sentence} Other documents move to trash.`;
};

// Names the collections this key moves to trash without approval.
const unattendedSentence = (scope: McpxToolScope): string => {
	const unattended = slugsFor(scope, "delete").collections.filter(
		(slug) => scope.capabilities.collections[slug]?.deleteUnattended === true,
	);

	return unattended.length === 0
		? ""
		: ` Exception: in ${unattended.join(", ")} this call moves the document to trash at once and returns the delete result, with no confirmation.`;
};

/*
 * A delete is held to `access.delete`, a trash move to `access.update` as
 * well. Both are checked before the call is stored, with the `data` a trash
 * move sends. A query constraint must match the document.
 */
const mayDelete = async (
	req: PayloadRequest,
	target: CollectionRef,
): Promise<boolean> => {
	const { config } = target;
	const data = config.trash ? { deletedAt: new Date().toISOString() } : {};
	const rules = config.trash
		? [config.access.delete, config.access.update]
		: [config.access.delete];
	let where: Where = { id: { equals: target.id } };

	for (const rule of rules) {
		// eslint-disable-next-line no-await-in-loop
		const result = await executeAccess(
			{ id: target.id, data, disableErrors: true, req },
			rule,
		);

		if (result === false) {
			return false;
		}

		if (typeof result === "object") {
			where = combineQueries(where, result);
		}
	}

	const { totalDocs } = await req.payload.count({
		collection: target.slug,
		where,
		overrideAccess: true,
		trash: true,
		req,
	});

	return totalDocs > 0;
};

/**
 * The panel's view of a stored delete.
 */
const confirm: McpxToolConfirm = {
	label: "Delete documents",
	/*
	 * Titled after what is live, the published version, with the latest
	 * draft's title added where it differs, so the reviewer sees what the
	 * public loses.
	 */
	summarize: async ({ args }, req) => {
		const slug = String(args["collection"]);
		const id = args["id"] as number | string;
		const config = req.payload.collections[slug]?.config;
		const titleField = config?.admin.useAsTitle;
		const read = async (draft: boolean) =>
			config
				? ((await req.payload.findByID({
						collection: slug,
						id,
						depth: 0,
						draft,
						overrideAccess: false,
						disableErrors: true,
						req,
					})) as null | Record<string, unknown>)
				: null;
		const titleOf = (doc: null | Record<string, unknown>) => {
			const value = titleField === undefined ? undefined : doc?.[titleField];

			return typeof value === "string" && value !== "" ? value : undefined;
		};

		const published = await read(false);
		const live = titleOf(published);
		const latest = titleOf(await read(true));
		const title =
			live === undefined
				? latest
				: latest !== undefined && latest !== live
					? `${live} (draft: ${latest})`
					: live;
		const status = published?.["_status"];
		const label =
			typeof config?.labels.singular === "function"
				? undefined
				: translateStatic(config?.labels.singular, req.i18n);

		return {
			label: label ?? slug,
			...(title === undefined ? {} : { title }),
			...(typeof status === "string" ? { status } : {}),
			id: String(id),
			href: formatAdminURL({
				adminRoute: req.payload.config.routes.admin,
				path: `/collections/${slug}/${String(id)}`,
			}),
			permanent: config?.trash !== true,
			...(typeof args["reason"] === "string" ? { reason: args["reason"] } : {}),
		};
	},
};

/**
 * Deletes one collection document once the key's user approved the call. The
 * first call only checks and stores it; `runConfirmed` runs it again with the
 * stored arguments, pinned to the `updatedAt` read here. Available where the
 * config exposes `delete` and the key has the `delete` checkbox.
 */
export const deleteDocument = defineMcpxTool({
	name: "deleteDocument",
	description: (scope) =>
		`${DESCRIPTION}${permanenceSentence(scope)}${unattendedSentence(scope)}`,
	annotations: { destructiveHint: true, openWorldHint: false },
	isEnabled: (scope) => scope.uploads && scope.collections.deletable.length > 0,
	inputSchema: (scope) => ({
		...entityShape(scope, "delete"),
		...idShape(scope, "delete"),
		expectedUpdatedAt: z
			.string()
			.optional()
			.describe(
				'"updatedAt" from your last read. Refused if the document changed since.',
			),
		reason: z
			.string()
			.max(500)
			.optional()
			.describe("Why, shown to the user who approves."),
	}),
	confirm,
	handler: async ({ args, scope, confirmation }) => {
		const target = resolveDocument(scope, args, "delete") as CollectionRef;
		const { req } = scope;
		const { payload } = req;
		// Typed as required, but unset unless the collection enables it.
		const trash = (target.config.trash as boolean | undefined) ?? false;

		return await withTransaction(req, async () => {
			const doc = (await payload.findByID({
				collection: target.slug,
				id: target.id,
				depth: 0,
				draft: true,
				trash: true,
				overrideAccess: false,
				disableErrors: true,
				req,
			})) as null | Record<string, unknown>;

			if (!doc) {
				throw new NotFound(req.t);
			}

			if (doc["deletedAt"]) {
				return errorResult(
					"The document is already in the trash. Emptying the trash is not available.",
				);
			}

			const stale = staleReadResult(
				doc,
				args.expectedUpdatedAt,
				"The document changed since you read it. Read it again before deleting.",
			);

			if (stale) {
				return stale;
			}

			if (!(await mayDelete(req, target))) {
				throw new Forbidden(req.t);
			}

			/*
			 * The config allows this only where deletes move to trash, so the
			 * trash check is a second guard.
			 */
			const unattended =
				trash &&
				scope.capabilities.collections[target.slug]?.deleteUnattended === true;

			if (!confirmation.confirmed && !unattended) {
				return await confirmation.request({
					...args,
					expectedUpdatedAt: new Date(doc["updatedAt"] as string).toISOString(),
				});
			}

			if (trash) {
				await payload.update({
					collection: target.slug,
					id: target.id,
					data: withTrashIntent({ deletedAt: new Date().toISOString() }),
					depth: 0,
					overrideAccess: false,
					overrideLock: false,
					req,
				});
			} else {
				await payload.delete({
					collection: target.slug,
					id: target.id,
					depth: 0,
					overrideAccess: false,
					overrideLock: false,
					req,
				});
			}

			return jsonResult({
				collection: target.slug,
				id: target.id,
				movedToTrash: trash,
			});
		});
	},
});
