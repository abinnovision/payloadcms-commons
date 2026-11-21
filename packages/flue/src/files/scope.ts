import { FILE_THREAD_FIELD } from "./collection.js";
import { MANAGED_BY } from "../keys/augment.js";
import { managedMarker, toAgentKey } from "../keys/manager.js";
import { FILE_HANDLE_HEADER } from "../protocol/files.js";
import { isRecord } from "../protocol/guards.js";
import { isId } from "../protocol/owner.js";
import { ownerWhere } from "../threads/owner.js";
import { resolveHandle } from "../threads/resolve.js";

import type { KeyDoc } from "../keys/manager.js";
import type { ResolveSettings } from "../threads/resolve.js";
import type {
	Access,
	DefaultDocumentIDType,
	PayloadRequest,
	Where,
} from "payload";

/** Where the plugin leaves what {@link flueThreadScoped} reads, on `config.custom`. */
export const SCOPE_SETTINGS_KEY = "@abinnovision/payloadcms-flue/scope";

/** What {@link flueThreadScoped} reads from the sanitized config. */
export type ScopeSettings = ResolveSettings & {
	/** The files collection, which has the `flueThread` field; `false` with files off. */
	files: false | string;
};

/*
 * What an agent request may reach: `true` leaves it to the wrapped access,
 * `false` refuses, an id narrows it to the files of that thread.
 */
type Scope = boolean | DefaultDocumentIDType;

interface Memo {
	apiKeyId: string;
	userId: string;
	handle: null | string;
	scope: Promise<Scope>;
}

const MANAGED_PREFIX = managedMarker("");

const settingsOf = (req: PayloadRequest): ScopeSettings | undefined =>
	req.payload.config.custom[SCOPE_SETTINGS_KEY] as ScopeSettings | undefined;

// The files `req.user` created; refuses everything without the plugin's settings.
const ownFiles: Access = ({ req }) => {
	const settings = settingsOf(req);

	return settings ? ownerWhere(req, settings.mcpx.userCollection) : false;
};

/*
 * The scope of a request made with a flue-managed mcpx key: the key's
 * thread when the handle header names a live thread of the key's user and
 * agent, and the request acts as that user, else `false`. Any other key is
 * left alone.
 */
const resolveScope = async (
	req: PayloadRequest,
	settings: ScopeSettings,
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
		!settings.files ||
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
 * the admin's or the in-process mcpx client's, are left alone, and so is
 * every request when the plugin is not installed.
 */
const scopeOf = (req: PayloadRequest): Promise<Scope> => {
	const { mcpx } = req.context as { mcpx?: unknown };
	const apiKeyId = isRecord(mcpx) ? mcpx["apiKeyId"] : undefined;
	const settings = settingsOf(req);

	if (!isId(apiKeyId) || !settings) {
		return Promise.resolve(true);
	}

	const handle = req.headers.get(FILE_HANDLE_HEADER);
	const userId = String(req.user?.id);
	const memo = req.context.flueScope as Memo | undefined;

	if (
		memo?.apiKeyId === String(apiKeyId) &&
		memo.userId === userId &&
		memo.handle === handle
	) {
		return memo.scope;
	}

	const scope = resolveScope(req, settings, apiKeyId, handle).catch(
		(error: unknown) => {
			req.payload.logger.error({
				err: error,
				msg: "[payloadcms-flue] Could not resolve the thread of an agent request; it is refused.",
			});

			return false;
		},
	);

	req.context.flueScope = {
		apiKeyId: String(apiKeyId),
		userId,
		handle,
		scope,
	} satisfies Memo;

	return scope;
};

/**
 * Keeps agents to the files of their current thread. Put it on the
 * `files.collection`'s `access.read`, which versions inherit unless the
 * collection sets its own `readVersions`, and on `update` and `delete`
 * where agents may write; not on `create`. Requests with a flue-managed
 * mcpx key get `access`'s result narrowed to the thread the `x-flue-handle`
 * header names, and nothing without a valid handle or on another
 * collection; every other request gets `access`'s result unchanged.
 * `access` defaults to the files the requesting user created, for users
 * of mcpx's user collection only.
 */
export const flueThreadScoped =
	(access: Access = ownFiles): Access =>
	async (args) => {
		const base = await access(args);

		if (!base) {
			return false;
		}

		const scope = await scopeOf(args.req);

		if (typeof scope === "boolean") {
			return scope && base;
		}

		if (args.slug !== settingsOf(args.req)?.files) {
			return false;
		}

		const own: Where = { [FILE_THREAD_FIELD]: { equals: scope } };

		return base === true ? own : { and: [base, own] };
	};
