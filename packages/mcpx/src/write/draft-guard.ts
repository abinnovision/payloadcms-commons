import { APIError } from "payload";
import { hasDraftsEnabled } from "payload/shared";

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
const scrubWriteArgs = (
	args: Record<string, unknown>,
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

		next["data"] = data;
	}

	next["draft"] = true;
	next["autosave"] = false;
	next["overrideLock"] = false;
	next["trash"] = false;

	return next;
};

const forceDraftWrite: CollectionBeforeOperationHook = (hookArgs) => {
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

	return scrubWriteArgs(args) as typeof args;
};

/**
 * The global counterpart of {@link forceDraftWrite}. Payload invokes a global's
 * `beforeOperation` with the whole argument bag and assigns the result back,
 * exactly as the collection path does and before it reads `draft`,
 * `publishAllLocales` or `data._status`, so the guard has the same reach here:
 * every MCP write to a global, builtin tool or custom.
 *
 * The global operation union has no `create` member because a global always
 * exists, so only `update` is intercepted. `STRIPPED_ARGS` covers the three
 * publish vectors `updateGlobal` accepts; the rest of the set does not exist on
 * that signature and filtering it is a harmless no-op. `slug` survives the
 * filter, so the operation still knows what it is updating.
 */
const forceDraftWriteGlobal: GlobalBeforeOperationHook = (hookArgs) => {
	const { operation, req } = hookArgs;
	const args = hookArgs.args as Record<string, unknown>;

	if (!isMcpxRequest(req) || operation !== "update") {
		return args;
	}

	return scrubWriteArgs(args);
};

/**
 * Refuses an MCP write that would still not land as a draft. An alarm rather
 * than the guarantee: `forceDraftWrite` should make it unreachable. It throws
 * instead of correcting `_status` because Payload has already chosen the write
 * branch by the time a `beforeChange` hook runs.
 */
const refuseUnlessDraft = (
	req: PayloadRequest,
	slug: string,
	data: unknown,
): void => {
	if (!isMcpxRequest(req)) {
		return;
	}

	const status = (data as { _status?: unknown })._status;

	if (status === "draft") {
		return;
	}

	req.payload.logger.warn(
		`[payloadcms-mcpx] Refused a write to ${slug} that would not have been a draft (_status: ${String(status)}).`,
	);

	throw new APIError(
		"MCP clients may only write drafts. This write was refused because it would not have been saved as one.",
		403,
	);
};

const refusePublish: CollectionBeforeChangeHook = ({
	collection,
	data,
	req,
}) => {
	refuseUnlessDraft(req, collection.slug, data);

	return data;
};

/** The global counterpart of {@link refusePublish}. */
const refusePublishGlobal: GlobalBeforeChangeHook = ({ data, global, req }) => {
	const next = data as Record<string, unknown>;

	refuseUnlessDraft(req, global.slug, next);

	return next;
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

/**
 * Attaches the guard to every global, exposed or not, for the same reason
 * `installDraftGuards` covers every collection: a custom tool running on an MCP
 * request must not be able to publish through a global the plugin config never
 * mentioned.
 */
const installGlobalDraftGuards = (globals: GlobalConfig[]): GlobalConfig[] =>
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

export {
	forceDraftWrite,
	forceDraftWriteGlobal,
	installDraftGuards,
	installGlobalDraftGuards,
	isMcpxRequest,
	refusePublish,
	refusePublishGlobal,
};
