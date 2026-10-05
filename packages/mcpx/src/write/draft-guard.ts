import { APIError } from "payload";
import { hasDraftsEnabled } from "payload/shared";

import {
	hasPublishIntent,
	hasTrashIntent,
	takeDuplicateIntent,
	takePublishIntent,
	takeTrashIntent,
	withTrashIntent,
} from "./publish-intent.js";
import { propOf } from "../guards.js";
import { isMcpxRequest } from "../request.js";

import type {
	CollectionBeforeChangeHook,
	CollectionBeforeOperationHook,
	CollectionConfig,
	GlobalBeforeChangeHook,
	GlobalBeforeOperationHook,
	GlobalConfig,
	PayloadRequest,
} from "payload";

/*
 * Cleared on every MCP write so a caller cannot supply them, except
 * `publishSpecificLocale`, which a marked publish keeps, and `duplicateFromID`,
 * which a marked duplicate keeps.
 */
const STRIPPED_ARGS = new Set([
	"where",
	"publishAllLocales",
	"unpublishAllLocales",
	"duplicateFromID",
	"selectedLocales",
	"overwriteExistingFiles",
]);

/*
 * `draft` alone does not force a draft save: Payload's update path saves one
 * only when `data._status !== "published"`, so `_status` is dropped. A publish
 * is granted only here, for the write `publishDocument` marked. A trash move
 * is granted the same way for the write `deleteDocument` marked: it keeps
 * `deletedAt` and nothing else of `data`, and is not a draft save, which would
 * leave the document's own `deletedAt` unchanged. `trash` stays false, so an
 * already trashed document is not found. A duplicate keeps `duplicateFromID`
 * only on the create `duplicateDocument` marked. Not covered: deletes, files
 * (the local API lifts `file` and `filePath` onto `req` first) and
 * anything going straight to `payload.db`. `restoreVersion` runs
 * `beforeChange` hooks, so {@link refusePublish} catches it.
 */
const scrubWriteArgs = (
	args: Record<string, unknown>,
	intent: "publish" | "trash" | undefined,
): Record<string, unknown> => {
	const publishing = intent === "publish";
	const next = Object.fromEntries(
		Object.entries(args).filter(
			([key]) =>
				!STRIPPED_ARGS.has(key) &&
				(publishing || key !== "publishSpecificLocale"),
		),
	);

	if (next["data"] && typeof next["data"] === "object") {
		const {
			_status: _ignoredStatus,
			deletedAt,
			...data
		} = next["data"] as Record<string, unknown>;

		next["data"] = publishing
			? { ...data, _status: "published" }
			: intent === "trash"
				? withTrashIntent({ deletedAt })
				: data;
	}

	next["draft"] = intent === undefined;
	next["autosave"] = false;
	next["overrideLock"] = false;
	next["trash"] = false;

	return next;
};

export const forceDraftWrite: CollectionBeforeOperationHook = (hookArgs) => {
	/*
	 * The argument union carries a deprecated `read` member, which is what the
	 * deprecation rule reacts to; the operation name itself is current API.
	 */
	// eslint-disable-next-line @typescript-eslint/no-deprecated
	const { args, operation, req } = hookArgs;

	if (
		!isMcpxRequest(req) ||
		(operation !== "create" && operation !== "update")
	) {
		return args;
	}

	if (operation === "create" && takeDuplicateIntent(args.data)) {
		const next = scrubWriteArgs(args, undefined);

		next["duplicateFromID"] = args.duplicateFromID;

		return next as typeof args;
	}

	const intent =
		operation !== "update"
			? undefined
			: hasPublishIntent(args.data)
				? "publish"
				: hasTrashIntent(args.data)
					? "trash"
					: undefined;

	return scrubWriteArgs(args, intent) as typeof args;
};

/**
 * The global counterpart of {@link forceDraftWrite}. `updateGlobal` reads
 * `draft` and the publish arguments before this hook runs, so only changes to
 * `data` take effect. A write to a global with drafts that did not ask for a
 * draft save is therefore refused here, and `_status` is restored for a publish.
 */
export const forceDraftWriteGlobal: GlobalBeforeOperationHook = (hookArgs) => {
	const { global, operation, req } = hookArgs;
	const args = hookArgs.args as Record<string, unknown>;

	if (!isMcpxRequest(req) || operation !== "update") {
		return args;
	}

	const publishing = hasPublishIntent(args["data"]);

	/*
	 * A save that is not a draft save writes the main table, which holds the
	 * live content once a locale was published on its own: the `_status` check
	 * cannot tell that write from a draft. Globals without drafts are live
	 * either way.
	 */
	if (!publishing && args["draft"] !== true && hasDraftsEnabled(global)) {
		req.payload.logger.warn(
			`[payloadcms-mcpx] Refused a write to ${global.slug} that did not ask for a draft save.`,
		);

		throw new APIError(
			"MCP clients may only write drafts. This write was refused because it would not have been saved as one. Use publishDocument to publish.",
			403,
		);
	}

	return scrubWriteArgs(args, publishing ? "publish" : undefined);
};

/*
 * Throws instead of correcting `_status`, because Payload has chosen the write
 * branch by the time `beforeChange` runs. For a collection this backs up
 * {@link forceDraftWrite}; for a global it is the enforcement. As the last hook
 * that needs the markers, it removes them. A marked trash move keeps the
 * stored `_status`, which is either.
 */
const refuseUnlessExpected = (
	req: PayloadRequest,
	slug: string,
	data: unknown,
): void => {
	const publishing = takePublishIntent(data);
	const trashing = takeTrashIntent(data);

	if (!isMcpxRequest(req) || trashing) {
		return;
	}

	const status = propOf(data, "_status");
	const expected = publishing ? "published" : "draft";

	if (status === expected) {
		return;
	}

	req.payload.logger.warn(
		`[payloadcms-mcpx] Refused a write to ${slug} that would not have been a ${expected} (_status: ${String(status)}).`,
	);

	throw new APIError(
		publishing
			? "This publish was refused because it would not have saved a published document."
			: "MCP clients may only write drafts. This write was refused because it would not have been saved as one. Use publishDocument to publish.",
		403,
	);
};

/**
 * Runs {@link refuseUnlessExpected} on every collection write. Returns `data`
 * unchanged; the hook exists for its throw.
 */
export const refusePublish: CollectionBeforeChangeHook = ({
	collection,
	data,
	req,
}) => {
	refuseUnlessExpected(req, collection.slug, data);

	return data;
};

export const refusePublishGlobal: GlobalBeforeChangeHook = ({
	data,
	global,
	req,
}) => {
	const next = data as Record<string, unknown>;

	refuseUnlessExpected(req, global.slug, next);

	return next;
};

interface Guarded<Operation, Change> {
	hooks?: { beforeChange?: Change[]; beforeOperation?: Operation[] };
}

/*
 * The operation guard goes on every entity and the change guard wherever drafts
 * exist. Both are appended last, so a user hook cannot override them.
 */
const appendGuards = <
	Operation,
	Change,
	T extends Guarded<Operation, Change> & Parameters<typeof hasDraftsEnabled>[0],
>(
	entities: T[],
	guards: { beforeChange: Change; beforeOperation: Operation },
): T[] =>
	entities.map((entity) => ({
		...entity,
		hooks: {
			...entity.hooks,
			beforeOperation: [
				...(entity.hooks?.beforeOperation ?? []),
				guards.beforeOperation,
			],
			...(hasDraftsEnabled(entity)
				? {
						beforeChange: [
							...(entity.hooks?.beforeChange ?? []),
							guards.beforeChange,
						],
					}
				: {}),
		},
	}));

/**
 * Attaches the draft guard to every collection: `forceDraftWrite` everywhere
 * (it does nothing outside MCP requests) and `refusePublish` wherever drafts
 * exist. It runs on the final collection list, so no collection escapes it.
 */
export const installDraftGuards = (
	collections: CollectionConfig[],
): CollectionConfig[] =>
	appendGuards(collections, {
		beforeChange: refusePublish,
		beforeOperation: forceDraftWrite,
	});

/**
 * Attaches the guard to every global, exposed or not: a custom tool running on
 * an MCP request must not be able to publish through a global the plugin config
 * never mentioned.
 */
export const installGlobalDraftGuards = (
	globals: GlobalConfig[],
): GlobalConfig[] =>
	appendGuards(globals, {
		beforeChange: refusePublishGlobal,
		beforeOperation: forceDraftWriteGlobal,
	});
