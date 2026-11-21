import { FILE_THREAD_FIELD } from "./collection.js";
import { MANAGED_BY } from "../keys/augment.js";
import { FILE_HANDLE_HEADER } from "../protocol/files.js";
import { isRecord } from "../protocol/guards.js";
import { isId } from "../protocol/owner.js";
import {
	findLiveThread,
	isLiveKey,
	stillAdmitted,
} from "../threads/resolve.js";

import type { NormalizedFiles, NormalizedOptions } from "../options.js";
import type { ResolveSettings } from "../threads/resolve.js";
import type {
	Access,
	CollectionBeforeChangeHook,
	DefaultDocumentIDType,
	PayloadRequest,
	Where,
} from "payload";

/** What the thread guard reads from the plugin's settings, with files on. */
export type GuardSettings = ResolveSettings &
	Pick<NormalizedOptions, "mcpx"> & { files: NormalizedFiles };

/*
 * What an agent request may read of the files collection: `true` leaves it
 * to the collection's access, `false` refuses, an id narrows it to the
 * files of that thread.
 */
type Scope = boolean | DefaultDocumentIDType;

interface Memo {
	apiKeyId: string;
	handle: null | string;
	scope: Promise<Scope>;
}

const MANAGED_PREFIX = "flue:";

const guards = new WeakSet<Access>();
const bindHooks = new WeakSet<CollectionBeforeChangeHook>();

/** Whether `access` is the thread guard {@link guardFiles} composed. */
export const isFileGuard = (access: unknown): boolean =>
	typeof access === "function" && guards.has(access as Access);

/** Whether `hook` is the agent upload hook {@link bindAgentUpload} made. */
export const isBindHook = (hook: unknown): boolean =>
	typeof hook === "function" &&
	bindHooks.has(hook as CollectionBeforeChangeHook);

const optionalString = (value: unknown): string | undefined =>
	typeof value === "string" ? value : undefined;

/*
 * The scope of a request made with a flue-managed mcpx key: the key's
 * thread when the handle header names a live thread of the key's user and
 * agent, else `false`. Any other key is left alone.
 */
const resolveScope = async (
	req: PayloadRequest,
	settings: GuardSettings,
	apiKeyId: number | string,
	handle: null | string,
): Promise<Scope> => {
	const { payload } = req;
	const key = (await payload.findByID({
		collection: settings.mcpx.apiKeysSlug,
		id: apiKeyId,
		depth: 0,
		overrideAccess: true,
		disableErrors: true,
		select: { [MANAGED_BY]: true, user: true, enabled: true, expiresAt: true },
	})) as null | Record<string, unknown>;

	if (!key) {
		return false;
	}

	const managedBy = optionalString(key[MANAGED_BY]);

	if (!managedBy?.startsWith(MANAGED_PREFIX)) {
		return true;
	}

	if (!handle) {
		return false;
	}

	const agent = managedBy.slice(MANAGED_PREFIX.length);
	const live = await findLiveThread(payload, settings, handle, agent);
	const { user } = req;

	if (
		!live ||
		!isLiveKey(
			{
				enabled: key["enabled"] === true,
				expiresAt: optionalString(key["expiresAt"]),
				user: isId(key["user"]) ? key["user"] : undefined,
				managedBy,
			},
			live.user,
			agent,
		) ||
		user?.collection !== live.user.collection ||
		String(user.id) !== String(live.user.id)
	) {
		return false;
	}

	if (
		live.thread.kind === "chat" &&
		!(await stillAdmitted(payload, settings, agent, live.user))
	) {
		return false;
	}

	return live.thread.id;
};

/*
 * The scope of `req`, resolved once per request: local operations inside
 * one mcpx request share its context. Requests without an mcpx key, such as
 * the admin's or the in-process mcpx client's, are left alone.
 */
const scopeOf = (
	req: PayloadRequest,
	settings: GuardSettings,
): Promise<Scope> => {
	const { mcpx } = req.context as { mcpx?: unknown };
	const apiKeyId = isRecord(mcpx) ? mcpx["apiKeyId"] : undefined;

	if (!isId(apiKeyId)) {
		return Promise.resolve(true);
	}

	const handle = req.headers.get(FILE_HANDLE_HEADER);
	const memo = req.context.flueGuard as Memo | undefined;

	if (memo?.apiKeyId === String(apiKeyId) && memo.handle === handle) {
		return memo.scope;
	}

	const scope = resolveScope(req, settings, apiKeyId, handle).catch(
		(error: unknown) => {
			req.payload.logger.error({
				err: error,
				msg: "[payloadcms-flue] Could not resolve the thread of an agent request; its file reads are refused.",
			});

			return false;
		},
	);

	req.context.flueGuard = {
		apiKeyId: String(apiKeyId),
		handle,
		scope,
	} satisfies Memo;

	return scope;
};

/**
 * `existing`, a `baseAccess.collections` function, narrowed on the files
 * collection to the current thread's files for agent requests. `read`,
 * `update` and `delete` answer a query on the field, `readVersions` on the
 * versions' copy, since Payload does not prefix what `baseAccess` answers.
 */
export const guardFiles = (
	existing: Access | undefined,
	settings: GuardSettings,
	operation: "delete" | "read" | "readVersions" | "update",
): Access => {
	const path =
		operation === "readVersions"
			? `version.${FILE_THREAD_FIELD}`
			: FILE_THREAD_FIELD;
	const guard: Access = async (args) => {
		const base = existing ? await existing(args) : true;

		if (!base || args.slug !== settings.files.collection) {
			return base;
		}

		const scope = await scopeOf(args.req, settings);

		if (typeof scope === "boolean") {
			return scope && base;
		}

		const own: Where = { [path]: { equals: scope } };

		return base === true ? own : { and: [base, own] };
	};

	guards.add(guard);

	return guard;
};

/**
 * Binds a file an agent creates to its thread, so the guard lets the agent
 * read its own output. Only a create made with a flue-managed key and a
 * live handle is bound; field access has already dropped any value the
 * client sent.
 */
export const bindAgentUpload = (
	settings: GuardSettings,
): CollectionBeforeChangeHook => {
	const hook: CollectionBeforeChangeHook = async ({ data, operation, req }) => {
		if (operation !== "create") {
			return data;
		}

		const scope = await scopeOf(req, settings);

		return typeof scope === "boolean"
			? data
			: { ...data, [FILE_THREAD_FIELD]: scope };
	};

	bindHooks.add(hook);

	return hook;
};
