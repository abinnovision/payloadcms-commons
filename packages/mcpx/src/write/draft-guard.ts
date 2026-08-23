import { APIError } from "payload";
import { hasDraftsEnabled } from "payload/shared";

import type {
	CollectionBeforeChangeHook,
	CollectionBeforeOperationHook,
	CollectionConfig,
	PayloadRequest,
} from "payload";

/**
 * Operation arguments that widen or redirect a write. Cleared on every MCP
 * create and update so a tool cannot smuggle them in.
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
 * Whether a request originated from the MCP endpoint. The endpoint stamps
 * `req.context.mcpx`, which travels into every local API call made with the
 * same `req`, including those made by custom tools.
 */
const isMcpxRequest = (req: PayloadRequest): boolean =>
	req.context.mcpx !== undefined;

/**
 * Forces every MCP write into a draft save.
 *
 * `draft` alone is not enough: Payload's update path only saves a draft when
 * `data._status !== "published"`, so `_status` is dropped and left to Payload.
 * This runs as `beforeOperation`, before Payload reads any of these arguments,
 * so it holds for every create and update on an MCP request, not only the
 * builtin tools. Deletes are not guarded in v1; custom tools that delete are
 * the integrator's responsibility.
 */
const forceDraftWrite: CollectionBeforeOperationHook = (hookArgs) => {
	// The argument union carries a deprecated `read` member, which is what the
	// deprecation rule reacts to; the operation name itself is current API.
	// eslint-disable-next-line @typescript-eslint/no-deprecated
	const { args, operation, req } = hookArgs;

	if (
		!isMcpxRequest(req) ||
		(operation !== "create" && operation !== "update")
	) {
		return args;
	}

	const next = Object.fromEntries(
		Object.entries(args).filter(([key]) => !STRIPPED_ARGS.has(key)),
	);

	if (next["data"] && typeof next["data"] === "object") {
		const {
			_status: _ignoredStatus,
			deletedAt: _ignoredDeletedAt,
			...data
		} = next["data"] as Record<string, unknown>;

		next["data"] = data;
	}

	next["draft"] = true;
	next["autosave"] = false;
	next["overrideLock"] = false;
	next["trash"] = false;

	return next as typeof args;
};

/**
 * Refuses an MCP write that would still not land as a draft. An alarm rather
 * than the guarantee: `forceDraftWrite` should make it unreachable. It throws
 * instead of correcting `_status` because Payload has already chosen the write
 * branch by the time a `beforeChange` hook runs.
 */
const refusePublish: CollectionBeforeChangeHook = ({
	collection,
	data,
	req,
}) => {
	if (!isMcpxRequest(req)) {
		return data;
	}

	const status = (data as { _status?: unknown })._status;

	if (status === "draft") {
		return data;
	}

	req.payload.logger.warn(
		`[payloadcms-mcpx] Refused a write to ${collection.slug} that would not have been a draft (_status: ${String(status)}).`,
	);

	throw new APIError(
		"MCP clients may only write drafts. This write was refused because it would not have been saved as one.",
		403,
	);
};

/**
 * Attaches the draft guard to every collection: `forceDraftWrite` everywhere
 * (it is a no-op outside MCP requests) and `refusePublish` wherever drafts
 * exist. Applied to the built collection list so nothing can join later
 * without being covered.
 */
const installDraftGuards = (
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

export { forceDraftWrite, installDraftGuards, isMcpxRequest, refusePublish };
