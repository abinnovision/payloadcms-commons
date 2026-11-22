import { executeAuthStrategies } from "payload";

import { hashApiKey } from "../api-keys/key.js";
import { storedCapabilities } from "../capabilities.js";
import { isPlainObject, propOf } from "../guards.js";
import { isStrategyPrincipal, strategyAuthOf } from "../strategy.js";

import type { DocumentId } from "../entity.js";
import type { NormalizedOptions } from "../options.js";
import type { McpxAuthResult } from "../types.js";
import type { Payload, PayloadRequest } from "payload";

const BEARER = /^Bearer\s+(\S+)\s*$/i;

// A key's `lastUsedAt` is refreshed at most this often.
const LAST_USED_INTERVAL_MS = 60 * 60 * 1000;

// An adapter may hand back a Date where the bundled ones give a string.
const toTime = (value: unknown): number =>
	typeof value === "string" || value instanceof Date
		? new Date(value).getTime()
		: Number.NaN;

const isId = (value: unknown): value is DocumentId =>
	typeof value === "string" || typeof value === "number";

/**
 * The id of a relationship value, populated or not.
 */
export const relationId = (value: unknown): DocumentId | undefined => {
	if (isId(value)) {
		return value;
	}

	return isPlainObject(value) && isId(value["id"]) ? value["id"] : undefined;
};

export const parseBearer = (headers: Headers): null | string => {
	const header = headers.get("authorization");

	if (!header) {
		return null;
	}

	return BEARER.exec(header.trim())?.[1] ?? null;
};

/**
 * Whether a resolved auth, from the default or a custom resolver, may become
 * `req.user`: a user of the configured user collection with an id, and either
 * a key id or a principal in the strategy format, not both.
 */
export const isValidAuthResult = (
	auth: unknown,
	options: Pick<NormalizedOptions, "userCollection">,
): auth is McpxAuthResult => {
	if (!isPlainObject(auth) || !isPlainObject(auth["user"])) {
		return false;
	}

	const principal = auth["principal"];
	const anchored = isId(auth["apiKeyId"])
		? principal === undefined
		: auth["apiKeyId"] === undefined && isStrategyPrincipal(principal);

	return (
		isId(auth["user"]["id"]) &&
		auth["user"]["collection"] === options.userCollection &&
		anchored
	);
};

/**
 * What a valid auth result's confirmations and grants are bound to.
 */
export const principalOf = (auth: McpxAuthResult): string =>
	auth.apiKeyId === undefined ? String(auth.principal) : String(auth.apiKeyId);

/**
 * Runs Payload's auth strategies for `req` again with admin autologin
 * disabled and makes their user `req.user`. Payload resolved `req.user`
 * before the endpoint ran, and with `admin.autoLogin` that is the autologin
 * user for a request without credentials.
 */
export const authenticateRequest = async (
	req: PayloadRequest,
): Promise<void> => {
	const headers = new Headers(req.headers);

	headers.set("DisableAutologin", "true");

	const { user } = await executeAuthStrategies({
		headers,
		payload: req.payload,
		req,
	});

	req.user = user;
};

/**
 * The auth a Payload auth strategy attached to `req.user` with
 * `withMcpxAuth`, or `null`. A cookie or JWT user carries none. Malformed
 * attached auth is logged and yields `null`.
 */
export const resolveStrategyAuth = (
	req: PayloadRequest,
	options: NormalizedOptions,
): McpxAuthResult | null => {
	const { user } = req;
	const attached: unknown = strategyAuthOf(user);

	if (!user || attached === undefined) {
		return null;
	}

	const principal = propOf(attached, "principal");
	const capabilities = propOf(attached, "capabilities");

	if (
		typeof principal !== "string" ||
		!isPlainObject(capabilities) ||
		!isValidAuthResult({ user, principal, capabilities }, options)
	) {
		req.payload.logger.error(
			'[payloadcms-mcpx] A Payload auth strategy attached invalid MCP auth: it needs a user of the user collection with an id, a principal like "source:id" and a capabilities object.',
		);

		return null;
	}

	return {
		user,
		principal,
		capabilities: storedCapabilities(options, capabilities),
	};
};

/**
 * A key document as {@link checkApiKey} reads it.
 */
export interface ApiKeyDoc {
	id: DocumentId;
	enabled?: boolean;
	user?: unknown;
	capabilities?: unknown;
	expiresAt?: unknown;
	lastUsedAt?: unknown;
}

/**
 * The checks a key passes once it is looked up: enabled, not expired, and its
 * user exists, is verified and is not locked out. Yields the user it acts as,
 * or `null`.
 */
export const checkApiKey = async (
	req: PayloadRequest,
	options: NormalizedOptions,
	keyDoc: ApiKeyDoc | undefined,
): Promise<McpxAuthResult | null> => {
	const userId = relationId(keyDoc?.user);

	if (!keyDoc || keyDoc.enabled !== true || userId === undefined) {
		return null;
	}

	// An unparseable `expiresAt` is NaN and does not expire the key.
	if (toTime(keyDoc.expiresAt) <= Date.now()) {
		return null;
	}

	const { payload } = req;
	const userCollection = payload.collections[options.userCollection];
	const lookup = {
		collection: options.userCollection,
		id: userId,
		overrideAccess: true,
		disableErrors: true,
	} as const;
	const [user, lock] = await Promise.all([
		payload.findByID({
			...lookup,
			depth: userCollection?.config.auth.depth ?? 0,
		}),
		/*
		 * `lockUntil` is hidden, so it is read on its own: showing hidden fields
		 * on the user itself would hand its hash, salt and tokens to every tool.
		 */
		payload.findByID({
			...lookup,
			depth: 0,
			showHiddenFields: true,
			select: { lockUntil: true },
		}),
	]);

	const lockUntil = toTime(lock?.["lockUntil"]);

	if (!user || user["_verified"] === false || lockUntil > Date.now()) {
		return null;
	}

	return {
		user: {
			...user,
			collection: options.userCollection,
			_strategy: "mcpx-api-key",
		},
		apiKeyId: keyDoc.id,
		capabilities: keyDoc.capabilities,
	};
};

// The key fields {@link checkApiKey} reads.
const KEY_SELECT = {
	enabled: true,
	user: true,
	capabilities: true,
	expiresAt: true,
} as const;

/**
 * The user the key `id` acts as, or `null`, under the same checks as the
 * bearer lookup.
 */
export const resolveApiKeyById = async (
	req: PayloadRequest,
	options: NormalizedOptions,
	id: DocumentId,
): Promise<McpxAuthResult | null> => {
	const keyDoc = (await req.payload.findByID({
		collection: options.apiKeysSlug,
		id,
		depth: 0,
		overrideAccess: true,
		disableErrors: true,
		select: KEY_SELECT,
	})) as ApiKeyDoc | null;

	return await checkApiKey(req, options, keyDoc ?? undefined);
};

/*
 * The secrets a stored key index may have been written under. Payload 4 keeps
 * previous secrets in its keyring, as its own API key strategy does; Payload 3
 * has only `secret`. Indexes are written under the active secret.
 */
const indexSecrets = (payload: Payload): string[] => {
	const { encryptionKeyring } = payload as {
		encryptionKeyring?: { all: { legacyKey: string }[] };
	};

	return encryptionKeyring
		? encryptionKeyring.all.map((entry) => entry.legacyKey)
		: [payload.secret];
};

/**
 * Resolves the bearer key of a request to the user it acts as.
 *
 * The key is looked up by its HMAC index under every secret of the keyring,
 * the same way Payload resolves its own API keys. A missing, unknown, disabled or orphaned key yields `null`; nothing
 * here throws, so the handler alone decides how a refusal looks.
 */
export const resolveApiKeyAuth = async (
	req: PayloadRequest,
	options: NormalizedOptions,
): Promise<McpxAuthResult | null> => {
	const key = parseBearer(req.headers);
	if (key === null) {
		return null;
	}

	const { payload } = req;
	const { docs } = await payload.find({
		collection: options.apiKeysSlug,
		where: {
			apiKeyIndex: {
				in: indexSecrets(payload).map((secret) => hashApiKey(secret, key)),
			},
		},
		limit: 1,
		pagination: false,
		depth: 0,
		overrideAccess: true,
		select: { ...KEY_SELECT, lastUsedAt: true },
	});

	const keyDoc = docs[0] as ApiKeyDoc | undefined;
	const auth = await checkApiKey(req, options, keyDoc);

	if (!auth || !keyDoc) {
		return null;
	}

	const lastUsed = toTime(keyDoc.lastUsedAt);

	if (Number.isNaN(lastUsed) || Date.now() - lastUsed > LAST_USED_INTERVAL_MS) {
		/*
		 * The marker keeps the key collection's hooks from recomputing the index.
		 * A failed touch must not refuse a valid key.
		 */
		try {
			await payload.update({
				collection: options.apiKeysSlug,
				id: keyDoc.id,
				data: { lastUsedAt: new Date().toISOString() },
				overrideAccess: true,
				depth: 0,
				context: { mcpxTouch: true },
			});
		} catch (error) {
			payload.logger.warn({
				err: error,
				msg: "[payloadcms-mcpx] Could not record the last use of an MCP API key.",
			});
		}
	}

	return auth;
};
