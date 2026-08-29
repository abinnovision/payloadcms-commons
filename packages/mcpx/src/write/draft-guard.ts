import { APIError } from "payload";
import { hasDraftsEnabled } from "payload/shared";

import { hasPublishIntent, takePublishIntent } from "./publish-intent.js";
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

/**
 * Operation arguments that widen or redirect a write. Cleared on every MCP
 * create and update, publishes included, so a tool cannot smuggle them in.
 */
const STRIPPED_ARGS = new Set([
	"where",
	"publishAllLocales",
	"publishSpecificLocale",
	"unpublishAllLocales",
	"duplicateFromID",
	"selectedLocales",
	"overwriteExistingFiles",
]);

/**
 * Forces every MCP write into a draft save, unless it is the one write
 * `publishDocument` asked for.
 *
 * `draft` alone is not enough: Payload's update path only saves a draft when
 * `data._status !== "published"`, so `_status` is dropped and left to Payload.
 * This runs as `beforeOperation`, before Payload reads any of these arguments,
 * so it holds for every create and update on an MCP request, not only the
 * builtin tools. Deletes are not guarded in v1; custom tools that delete are
 * the integrator's responsibility. `restoreVersion` and `duplicate` are outside
 * the operation filter too — `restoreVersion` is caught by `refusePublish`
 * because it runs the collection's `beforeChange` hooks, and anything going
 * straight to `payload.db` bypasses all of this.
 *
 * On a write carrying the publish marker the scrubbing is unchanged — the whole
 * `STRIPPED_ARGS` list still goes, `deletedAt` still goes, autosave, locks and
 * trash are still forced off. Only `draft` and `_status` differ. Writing
 * `_status` here rather than in the tool keeps the tool honest: it asks to
 * publish, and this is the only thing that can grant it.
 */
const scrubWriteArgs = (
	args: Record<string, unknown>,
	publishing: boolean,
): Record<string, unknown> => {
	const next = Object.fromEntries(
		Object.entries(args).filter(([key]) => !STRIPPED_ARGS.has(key)),
	);

	if (next["data"] && typeof next["data"] === "object") {
		const {
			_status: _ignoredStatus,
			deletedAt: _ignoredDeletedAt,
			...data
		} = next["data"] as Record<string, unknown>;

		next["data"] = publishing ? { ...data, _status: "published" } : data;
	}

	next["draft"] = !publishing;
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

	const publishing = operation === "update" && hasPublishIntent(args.data);

	return scrubWriteArgs(args, publishing) as typeof args;
};

/**
 * The global counterpart of {@link forceDraftWrite}, with one important
 * difference: Payload's `updateGlobal` destructures `draft`,
 * `publishAllLocales`, `publishSpecificLocale`, `unpublishAllLocales` and
 * `overrideLock` *before* it runs `beforeOperation`, and re-reads only `data`
 * afterwards. Setting those here is a no-op. What still lands is `data`, and
 * that is what the global draft guarantee actually rests on: `_status` is
 * stripped, so a rogue `updateGlobal({ draft: false })` reaches
 * {@link refusePublishGlobal} with no status and is refused there. The alarm,
 * not the correction, is load-bearing for globals.
 *
 * The publish branch matters for the same reason. `publishDocument` passes
 * `draft: false` at the call site because the hook cannot, and this hook must
 * put `_status` back rather than strip it.
 *
 * The global operation union has no `create` member because a global always
 * exists, so only `update` is intercepted.
 */
export const forceDraftWriteGlobal: GlobalBeforeOperationHook = (hookArgs) => {
	const { operation, req } = hookArgs;
	const args = hookArgs.args as Record<string, unknown>;

	if (!isMcpxRequest(req) || operation !== "update") {
		return args;
	}

	return scrubWriteArgs(args, hasPublishIntent(args["data"]));
};

/**
 * Refuses an MCP write that would still not land as a draft, and — on the write
 * carrying the publish marker — refuses anything that would not land as a
 * publish. An alarm rather than the guarantee for collections, where
 * `forceDraftWrite` should make it unreachable; the guarantee itself for
 * globals, per {@link forceDraftWriteGlobal}. It throws instead of correcting
 * `_status` because Payload has already chosen the write branch by the time a
 * `beforeChange` hook runs.
 *
 * This is the last hook that needs the marker, so it takes it off here.
 */
const refuseUnlessExpected = (
	req: PayloadRequest,
	slug: string,
	data: unknown,
): void => {
	const publishing = takePublishIntent(data);

	if (!isMcpxRequest(req)) {
		return;
	}

	const status = (data as { _status?: unknown })._status;
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

export const refusePublish: CollectionBeforeChangeHook = ({
	collection,
	data,
	req,
}) => {
	refuseUnlessExpected(req, collection.slug, data);

	return data;
};

/** The global counterpart of {@link refusePublish}. */
export const refusePublishGlobal: GlobalBeforeChangeHook = ({
	data,
	global,
	req,
}) => {
	const next = data as Record<string, unknown>;

	refuseUnlessExpected(req, global.slug, next);

	return next;
};

/**
 * Attaches the draft guard to every collection: `forceDraftWrite` everywhere
 * (it is a no-op outside MCP requests) and `refusePublish` wherever drafts
 * exist. Applied to the built collection list so nothing can join later
 * without being covered. Both are appended last, so a user hook cannot win.
 */
export const installDraftGuards = (
	collections: CollectionConfig[],
): CollectionConfig[] =>
	collections.map((collection) => ({
		...collection,
		hooks: {
			...collection.hooks,
			beforeOperation: [
				...(collection.hooks?.beforeOperation ?? []),
				forceDraftWrite,
			],
			...(hasDraftsEnabled(collection)
				? {
						beforeChange: [
							...(collection.hooks?.beforeChange ?? []),
							refusePublish,
						],
					}
				: {}),
		},
	}));

/**
 * Attaches the guard to every global, exposed or not, for the same reason
 * `installDraftGuards` covers every collection: a custom tool running on an MCP
 * request must not be able to publish through a global the plugin config never
 * mentioned.
 */
export const installGlobalDraftGuards = (
	globals: GlobalConfig[],
): GlobalConfig[] =>
	globals.map((global) => ({
		...global,
		hooks: {
			...global.hooks,
			beforeOperation: [
				...(global.hooks?.beforeOperation ?? []),
				forceDraftWriteGlobal,
			],
			...(hasDraftsEnabled(global)
				? {
						beforeChange: [
							...(global.hooks?.beforeChange ?? []),
							refusePublishGlobal,
						],
					}
				: {}),
		},
	}));
