import { APIError, ValidationError } from "payload";

import { generateApiKey, hashApiKey } from "../api-keys/key.js";
import { isPlainObject } from "../guards.js";

import type { DocumentId } from "../entity.js";
import type {
	KVAdapterResult,
	Payload,
	PayloadRequest,
	SanitizedConfig,
} from "payload";

const GRANT_TTL_MS = 5 * 60 * 1000;

const GRANTS_PER_KEY = 10;

// 32 random bytes in base64url.
export const ROW_ID = /^[\w-]{43}$/;

/*
 * The KV collection is only ever written through `payload.db`, which runs no
 * hooks and no access control. Without `req` no call joins a transaction, so a
 * rollback cannot undo a claim.
 */
export const NO_REQ = {};

// An unset fallback locale is stored as `null`.
type FallbackLocale = Exclude<PayloadRequest["fallbackLocale"], undefined>;

/**
 * A call stored with the request's locale and fallback locale at issue,
 * `null` when unset.
 */
export interface StoredCall {
	apiKeyId: DocumentId;
	tool: string;
	args: Record<string, unknown>;
	locale: null | string;
	fallbackLocale: FallbackLocale;
}

/**
 * The file an upload call declared.
 */
export interface UploadFile {
	filename: string;
	mimeType: string;
	size: number;
}

/**
 * A tool call waiting for its file, stored until the PUT that completes it.
 */
export interface UploadGrant extends StoredCall {
	kind: "upload";
	file: UploadFile;
	/**
	 * Epoch milliseconds.
	 */
	exp: number;
}

/**
 * The file of a document read through `getDocument`, stored until the GET
 * that serves it.
 */
export interface DownloadGrant {
	kind: "download";
	apiKeyId: DocumentId;
	collection: string;
	id: DocumentId;
	/**
	 * Whether the latest draft was read, rather than the published version.
	 */
	draft: boolean;
	/**
	 * The locale read and the request's fallback locale, `null` when unset.
	 */
	locale: null | string;
	fallbackLocale: FallbackLocale;
	/**
	 * Epoch milliseconds.
	 */
	exp: number;
}

export type Grant = DownloadGrant | UploadGrant;

export interface KvRow<T = unknown> {
	key: string;
	data: T;
}

/**
 * The key prefixes of a kind of row: waiting rows and the markers of used
 * ones.
 */
export const rowPrefixes = (
	kind: "confirmation" | "grant",
	apiKeyId: DocumentId,
): { prefix: string; usedPrefix: string } => ({
	prefix: `mcpx-${kind}:${String(apiKeyId)}:`,
	usedPrefix: `mcpx-${kind}-used:${String(apiKeyId)}:`,
});

/**
 * What a row is addressed by: the HMAC of its id, which the row key ends in.
 */
export const rowHandle = (payload: Payload, id: string): string =>
	hashApiKey(payload.secret, id);

export const expOf = (data: unknown): number =>
	isPlainObject(data) && typeof data["exp"] === "number" ? data["exp"] : 0;

/**
 * The KV collection slug, when Payload's database KV adapter backs it with a
 * unique `key`, which the single-use claim relies on. `undefined` otherwise.
 */
export const grantKvSlug = (config: SanitizedConfig): string | undefined => {
	const kv = config.kv as KVAdapterResult | undefined;
	const key = kv?.kvCollection?.fields.find(
		(field) => "name" in field && field.name === "key",
	);

	return key && "unique" in key && key.unique
		? kv?.kvCollection?.slug
		: undefined;
};

/**
 * KV rows whose key contains one of `fragments`.
 */
const findRows = async <T>(
	payload: Payload,
	slug: string,
	fragments: string[],
): Promise<KvRow<T>[]> => {
	const { docs } = await payload.db.find({
		collection: slug,
		where: { or: fragments.map((fragment) => ({ key: { like: fragment } })) },
		limit: 0,
		pagination: false,
		req: NO_REQ,
	});

	return docs as unknown as KvRow<T>[];
};

/**
 * KV rows whose key starts with one of `prefixes`. `like` matches a
 * substring, so the prefix is checked again here.
 */
export const rowsWith = async <T = unknown>(
	payload: Payload,
	slug: string,
	prefixes: string[],
): Promise<KvRow<T>[]> =>
	(await findRows<T>(payload, slug, prefixes)).filter((row) =>
		prefixes.some((prefix) => row.key.startsWith(prefix)),
	);

/**
 * Stores `data` under `prefix` and the HMAC of a fresh id, and returns the id,
 * the only copy of which goes to the client. Expired rows under `prefix` and
 * `usedPrefix` are purged first, and at most `cap` unexpired rows may wait
 * under `prefix`; past that, `capMessage` is thrown with 429.
 */
export const issueRow = async (
	payload: Payload,
	slug: string,
	args: {
		prefix: string;
		usedPrefix: string;
		cap: number;
		capMessage: string;
		ttlMs: number;
		data: Record<string, unknown>;
	},
): Promise<{ id: string; exp: number }> => {
	const now = Date.now();
	const rows = await rowsWith(payload, slug, [args.prefix, args.usedPrefix]);
	const expired = rows.filter((row) => expOf(row.data) <= now);

	if (expired.length > 0) {
		await payload.db.deleteMany({
			collection: slug,
			where: { key: { in: expired.map((row) => row.key) } },
			req: NO_REQ,
		});
	}

	const waiting = rows.filter(
		(row) => row.key.startsWith(args.prefix) && expOf(row.data) > now,
	);

	if (waiting.length >= args.cap) {
		throw new APIError(args.capMessage, 429);
	}

	const id = generateApiKey();
	const exp = now + args.ttlMs;

	await payload.db.create({
		collection: slug,
		data: {
			key: `${args.prefix}${rowHandle(payload, id)}`,
			data: { ...args.data, exp },
		},
		req: NO_REQ,
	});

	return { id, exp };
};

/**
 * Marks the row under `handle` used and removes it. The marker is a
 * unique-key insert, so of two concurrent claims exactly one returns `true`.
 */
export const claimRow = async (
	payload: Payload,
	slug: string,
	prefixes: { prefix: string; usedPrefix: string },
	handle: string,
	exp: number,
): Promise<boolean> => {
	try {
		await payload.db.create({
			collection: slug,
			data: { key: `${prefixes.usedPrefix}${handle}`, data: { exp } },
			req: NO_REQ,
		});
	} catch (error) {
		if (error instanceof ValidationError) {
			return false;
		}

		throw error;
	}

	await payload.db.deleteOne({
		collection: slug,
		where: { key: { equals: `${prefixes.prefix}${handle}` } },
		req: NO_REQ,
	});

	return true;
};

/**
 * The KV slug and key id of the request, which a call that stores a grant or
 * a confirmation needs. Throws where the endpoint would not offer one.
 */
export const grantContext = (
	req: PayloadRequest,
): { slug: string; apiKeyId: DocumentId } => {
	const slug = grantKvSlug(req.payload.config);
	const apiKeyId = req.context.mcpx?.apiKeyId;

	if (slug === undefined || apiKeyId === undefined) {
		throw new Error("A grant or confirmation needs a database KV and a key.");
	}

	return { slug, apiKeyId };
};

/**
 * Stores a grant and returns its id. A key may hold at most
 * {@link GRANTS_PER_KEY} grants.
 */
export const issueGrant = async (
	payload: Payload,
	slug: string,
	grant: Omit<DownloadGrant, "exp"> | Omit<UploadGrant, "exp">,
): Promise<{ id: string; exp: number }> =>
	await issueRow(payload, slug, {
		...rowPrefixes("grant", grant.apiKeyId),
		cap: GRANTS_PER_KEY,
		capMessage: `This key already has ${String(GRANTS_PER_KEY)} uploads or downloads waiting. Use or abandon them first; each expires 5 minutes after it was issued.`,
		ttlMs: GRANT_TTL_MS,
		data: grant,
	});

/**
 * Loads the grant for `grantId` and marks it used, or returns `undefined` for
 * a malformed, unknown, expired or used one. A malformed id is refused before
 * any database read.
 */
export const claimGrant = async (
	payload: Payload,
	slug: string,
	grantId: string,
): Promise<Grant | undefined> => {
	if (!ROW_ID.test(grantId)) {
		return undefined;
	}

	const handle = rowHandle(payload, grantId);
	const row = (await findRows<Grant>(payload, slug, [handle])).find(
		(candidate) =>
			candidate.key.startsWith("mcpx-grant:") &&
			candidate.key.endsWith(`:${handle}`),
	);
	const grant = row?.data;

	if (!row || !isPlainObject(grant) || expOf(grant) <= Date.now()) {
		return undefined;
	}

	const prefixes = rowPrefixes("grant", grant.apiKeyId);

	return row.key === `${prefixes.prefix}${handle}` &&
		(await claimRow(payload, slug, prefixes, handle, grant.exp))
		? grant
		: undefined;
};
