import {
	assertFilesCollection,
	assertStartedFilesCollection,
	FILE_THREAD_FIELD,
} from "./collection.js";
import { MANAGED_BY } from "../keys/augment.js";
import { managedMarker, toAgentKey } from "../keys/manager.js";
import { invalid } from "../options.js";
import { FILE_HANDLE_HEADER } from "../protocol/files.js";
import { isRecord } from "../protocol/guards.js";
import { isId } from "../protocol/owner.js";
import { resolveHandle } from "../threads/resolve.js";

import type { KeyDoc } from "../keys/manager.js";
import type { NormalizedFiles } from "../options.js";
import type { ResolveSettings } from "../threads/resolve.js";
import type {
	Access,
	CollectionBeforeChangeHook,
	Config,
	DefaultDocumentIDType,
	Payload,
	PayloadRequest,
	Where,
} from "payload";

/** What the thread guard reads from the plugin's settings, with files on. */
export type GuardSettings = ResolveSettings & { files: NormalizedFiles };

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

const MANAGED_PREFIX = managedMarker("");

type CollectionsAccess = NonNullable<
	NonNullable<Config["baseAccess"]>["collections"]
>;

// The operations the thread guard narrows on the files collection.
const GUARDED = ["read", "readVersions", "update", "delete"] as const;

const guards = new WeakSet<Access>();
const bindHooks = new WeakSet<CollectionBeforeChangeHook>();

/*
 * The scope of a request made with a flue-managed mcpx key: the key's
 * thread when the handle header names a live thread of the key's user and
 * agent, and the request acts as that user, else `false`. Any other key is
 * left alone.
 */
const resolveScope = async (
	req: PayloadRequest,
	settings: GuardSettings,
	apiKeyId: number | string,
	handle: null | string,
): Promise<Scope> => {
	const { payload, user } = req;
	const doc = (await payload.findByID({
		collection: settings.mcpx.apiKeysSlug,
		id: apiKeyId,
		depth: 0,
		overrideAccess: true,
		disableErrors: true,
		select: { [MANAGED_BY]: true, user: true, enabled: true, expiresAt: true },
	})) as KeyDoc | null;

	if (!doc) {
		return false;
	}

	const key = toAgentKey(doc);
	const { managedBy } = key;

	if (!managedBy?.startsWith(MANAGED_PREFIX)) {
		return true;
	}

	// The request must act as the key's user; checked before any thread lookup.
	if (
		!handle ||
		user?.collection !== settings.mcpx.userCollection ||
		String(user.id) !== String(key.user)
	) {
		return false;
	}

	const live = await resolveHandle(
		payload,
		settings,
		handle,
		managedBy.slice(MANAGED_PREFIX.length),
		() => Promise.resolve(key),
	);

	return live &&
		user.collection === live.user.collection &&
		String(user.id) === String(live.user.id)
		? live.thread.id
		: false;
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

/** `baseAccess.collections` with each guarded operation wrapped by {@link guardFiles}. */
export const guardBaseAccess = (
	collections: CollectionsAccess | undefined,
	settings: GuardSettings,
): CollectionsAccess => ({
	...collections,
	...Object.fromEntries(
		GUARDED.map((operation) => [
			operation,
			guardFiles(collections?.[operation], settings, operation),
		]),
	),
});

/**
 * Re-checks the started files collection, since a storage adapter or a
 * later plugin may change it after flue ran: it must still pass
 * {@link assertFilesCollection}, keep the thread guard in `baseAccess`,
 * keep a server-only `createdBy` and `flueThread`, and keep the agent
 * upload hook.
 */
export const assertFilesGuarded = async (
	payload: Payload,
	settings: GuardSettings,
): Promise<void> => {
	const files = payload.collections[settings.files.collection]?.config;
	const { userCollection } = settings.mcpx;

	if (!files) {
		throw invalid(
			`files.collection "${settings.files.collection}" is not in the config.`,
		);
	}

	assertFilesCollection(
		{ ...files, fields: files.flattenedFields },
		userCollection,
		{ warn: () => undefined },
	);

	const guarded = payload.config.baseAccess?.collections;

	if (
		!GUARDED.every((operation) => guards.has(guarded?.[operation] as Access))
	) {
		throw invalid(
			"Another plugin replaced config.baseAccess after flue, which drops the thread guard on the files collection. Register it before flue.",
		);
	}

	await assertStartedFilesCollection(files, userCollection);

	if (!files.hooks.beforeChange.some((hook) => bindHooks.has(hook))) {
		throw invalid(
			`Another plugin removed flue's hook from the files collection "${files.slug}", which binds agent uploads to their thread.`,
		);
	}
};
