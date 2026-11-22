import { randomBytes } from "node:crypto";

import { invalid } from "../options.js";
import { isRecord } from "../protocol/guards.js";
import { isId } from "../protocol/owner.js";
import { handleHash } from "../threads/handle.js";

import type { RunKind } from "../protocol/context.js";
import type {
	DefaultDocumentIDType,
	KVAdapterResult,
	Payload,
	PayloadRequest,
	SanitizedConfig,
} from "payload";

/*
 * Live windows and tokens live in Payload's database KV, written through
 * `payload.db`, which runs no hooks and no access control. Calls without
 * `req` join no transaction.
 */
const NO_REQ = {};

const TOKEN = /^flue_[\w-]{43}$/;

const LIVE_PREFIX = "flue-live:";
const TOKEN_PREFIX = "flue-token:";
const RUN_KINDS: readonly string[] = ["chat", "reactive", "ambient"];

// How often a mint may purge expired token rows, per Payload instance.
const PURGE_EVERY_MS = 60_000;
const lastPurge = new WeakMap<Payload, number>();

/** A thread of a user, which a live window and a token belong to. */
export interface ThreadOf {
	user: DefaultDocumentIDType;
	thread: DefaultDocumentIDType;
}

/**
 * An open live window. `gen` is new whenever the window opens after it was
 * closed or expired, so tokens of an earlier opening stay refused.
 */
export interface LiveWindow {
	exp: number;
	gen: string;
}

/** What a token row holds besides its expiry. */
export interface TokenGrant extends ThreadOf {
	agent: string;
	kind: RunKind;
	/** The generation of the live window the token was minted under. */
	gen: string;
}

interface Row {
	key: string;
	data: unknown;
}

/**
 * The KV collection slug, when Payload's database KV adapter backs it with a
 * unique `key`. `undefined` otherwise.
 */
const tokenKvSlug = (config: SanitizedConfig): string | undefined => {
	const kv = config.kv as KVAdapterResult | undefined;
	const key = kv?.kvCollection?.fields.find(
		(field) => "name" in field && field.name === "key",
	);

	return key && "unique" in key && key.unique
		? kv?.kvCollection?.slug
		: undefined;
};

/** Throws unless Payload's database KV adapter backs the config's `kv`. */
export const assertTokenKv = (config: SanitizedConfig): string => {
	const slug = tokenKvSlug(config);

	if (slug === undefined) {
		throw invalid(
			"Agent tokens need Payload's database KV adapter, the default `kv`.",
		);
	}

	return slug;
};

const slugOf = (payload: Payload): string => assertTokenKv(payload.config);

const liveKey = ({ user, thread }: ThreadOf): string =>
	`${LIVE_PREFIX}${String(user)}:${String(thread)}`;

const tokenKey = (token: string): string =>
	`${TOKEN_PREFIX}${handleHash(token)}`;

const expOf = (data: unknown): number =>
	isRecord(data) && typeof data["exp"] === "number" ? data["exp"] : 0;

const windowOf = (data: unknown): LiveWindow | undefined =>
	isRecord(data) && typeof data["gen"] === "string" && expOf(data) > Date.now()
		? { exp: expOf(data), gen: data["gen"] }
		: undefined;

const findRow = async (payload: Payload, key: string): Promise<Row | null> =>
	(await payload.db.findOne({
		collection: slugOf(payload),
		where: { key: { equals: key } },
		req: NO_REQ,
	})) as null | Row;

/*
 * The rows whose key starts with `prefix`. `like` matches a substring and
 * may treat `_` as a wildcard, so the prefix is checked again here.
 */
const rowsWith = async (
	payload: Payload,
	prefix: string,
	req: Partial<PayloadRequest> = NO_REQ,
): Promise<Row[]> => {
	const { docs } = await payload.db.find({
		collection: slugOf(payload),
		where: { key: { like: prefix } },
		limit: 0,
		pagination: false,
		req,
	});

	return (docs as unknown as Row[]).filter((row) => row.key.startsWith(prefix));
};

const deleteKeys = async (
	payload: Payload,
	keys: string[],
	req: Partial<PayloadRequest> = NO_REQ,
): Promise<void> => {
	if (keys.length > 0) {
		await payload.db.deleteMany({
			collection: slugOf(payload),
			where: { key: { in: keys } },
			req,
		});
	}
};

/**
 * Opens or extends the live window of a thread to now plus `ttlMs` and
 * returns it. One row per thread, upserted on every turn. An open window
 * keeps its generation; a closed or expired one gets a new one.
 */
export const openLiveWindow = async (
	payload: Payload,
	of: ThreadOf,
	ttlMs: number,
): Promise<LiveWindow> => {
	const key = liveKey(of);
	const current = windowOf((await findRow(payload, key))?.data);
	const gen = current?.gen ?? randomBytes(16).toString("base64url");
	const exp = Date.now() + ttlMs;

	await payload.db.upsert({
		collection: slugOf(payload),
		where: { key: { equals: key } },
		data: { key, data: { exp, gen } },
		returning: false,
		req: NO_REQ,
	});

	return { exp, gen };
};

/** The thread's live window, or `undefined` once it is closed or expired. */
export const liveWindow = async (
	payload: Payload,
	of: ThreadOf,
): Promise<LiveWindow | undefined> =>
	windowOf((await findRow(payload, liveKey(of)))?.data);

/** Closes the thread's live window inside `req`'s transaction. */
export const closeLiveWindow = async (
	payload: Payload,
	of: ThreadOf,
	req: PayloadRequest,
): Promise<void> => {
	await deleteKeys(payload, [liveKey(of)], req);
};

/** Closes every live window of `user` inside `req`'s transaction. */
export const closeUserWindows = async (
	payload: Payload,
	user: DefaultDocumentIDType,
	req: PayloadRequest,
): Promise<void> => {
	const rows = await rowsWith(payload, `${LIVE_PREFIX}${String(user)}:`, req);

	await deleteKeys(
		payload,
		rows.map((row) => row.key),
		req,
	);
};

/** Deletes the expired token rows of every user. */
export const purgeExpiredTokens = async (payload: Payload): Promise<void> => {
	const now = Date.now();
	const expired = (await rowsWith(payload, TOKEN_PREFIX)).filter(
		(row) => expOf(row.data) <= now,
	);

	await deleteKeys(
		payload,
		expired.map((row) => row.key),
	);
};

/**
 * Mints a token for `grant`, valid for `ttlMs` but never past `windowExp`,
 * and returns it with its expiry. Only its SHA-256 is stored. Expired token
 * rows are purged first, at most once a minute per Payload instance.
 */
export const mintToken = async (
	payload: Payload,
	grant: TokenGrant,
	ttlMs: number,
	windowExp: number,
): Promise<{ token: string; exp: number }> => {
	const now = Date.now();

	if (now - (lastPurge.get(payload) ?? 0) >= PURGE_EVERY_MS) {
		lastPurge.set(payload, now);
		await purgeExpiredTokens(payload);
	}

	const token = `flue_${randomBytes(32).toString("base64url")}`;
	const exp = Math.min(now + ttlMs, windowExp);

	await payload.db.create({
		collection: slugOf(payload),
		data: {
			key: tokenKey(token),
			data: { ...grant, exp },
		},
		returning: false,
		req: NO_REQ,
	});

	return { token, exp };
};

/**
 * What an unexpired `token` grants, with its expiry, or `undefined`.
 * Anything not shaped like a token is not looked up.
 */
export const readToken = async (
	payload: Payload,
	token: string,
): Promise<(TokenGrant & { exp: number }) | undefined> => {
	if (!TOKEN.test(token)) {
		return undefined;
	}

	const data = (await findRow(payload, tokenKey(token)))?.data;
	const exp = expOf(data);

	if (
		!isRecord(data) ||
		!(exp > Date.now()) ||
		!isId(data["user"]) ||
		!isId(data["thread"]) ||
		typeof data["agent"] !== "string" ||
		typeof data["kind"] !== "string" ||
		!RUN_KINDS.includes(data["kind"]) ||
		typeof data["gen"] !== "string"
	) {
		return undefined;
	}

	return {
		user: data["user"],
		thread: data["thread"],
		agent: data["agent"],
		kind: data["kind"] as RunKind,
		gen: data["gen"],
		exp,
	};
};
