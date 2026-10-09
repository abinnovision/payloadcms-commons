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

// 32 random bytes in base64url.
export const LEASE_ID = /^[\w-]{43}$/;

/*
 * The KV collection is only ever written through `payload.db`, which runs no
 * hooks and no access control. Without `req` no call joins a transaction, so a
 * rollback cannot undo a claim.
 */
export const NO_REQ = {};

// An unset fallback locale is stored as `null`.
export type FallbackLocale = Exclude<
	PayloadRequest["fallbackLocale"],
	undefined
>;

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
 * A row of the KV collection that holds a lease.
 */
export interface LeaseRow<T = unknown> {
	key: string;
	data: T;
}

/**
 * The key prefixes of a kind of lease: waiting leases and the markers of used
 * ones.
 */
export const leasePrefixes = (
	kind: "confirmation" | "grant",
	apiKeyId: DocumentId,
): { prefix: string; usedPrefix: string } => ({
	prefix: `mcpx-${kind}:${String(apiKeyId)}:`,
	usedPrefix: `mcpx-${kind}-used:${String(apiKeyId)}:`,
});

/**
 * What a lease is addressed by: the HMAC of its id, which the row key ends in.
 */
export const leaseHandle = (payload: Payload, id: string): string =>
	hashApiKey(payload.secret, id);

const expOf = (data: unknown): number =>
	isPlainObject(data) && typeof data["exp"] === "number" ? data["exp"] : 0;

/**
 * The KV collection slug, when Payload's database KV adapter backs it with a
 * unique `key`, which the single-use claim relies on. `undefined` otherwise.
 */
export const leaseKvSlug = (config: SanitizedConfig): string | undefined => {
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
export const leasesMatching = async <T>(
	payload: Payload,
	slug: string,
	fragments: string[],
): Promise<LeaseRow<T>[]> => {
	const { docs } = await payload.db.find({
		collection: slug,
		where: { or: fragments.map((fragment) => ({ key: { like: fragment } })) },
		limit: 0,
		pagination: false,
		req: NO_REQ,
	});

	return docs as unknown as LeaseRow<T>[];
};

/**
 * KV rows whose key starts with one of `prefixes`. `like` matches a
 * substring, so the prefix is checked again here.
 */
export const leasesWith = async <T = unknown>(
	payload: Payload,
	slug: string,
	prefixes: string[],
): Promise<LeaseRow<T>[]> =>
	(await leasesMatching<T>(payload, slug, prefixes)).filter((row) =>
		prefixes.some((prefix) => row.key.startsWith(prefix)),
	);

/**
 * Stores `data` under `prefix` and the HMAC of a fresh id, and returns the id,
 * the only copy of which goes to the client. Expired rows under `prefix` and
 * `usedPrefix` are purged first, and at most `cap` unexpired rows may wait
 * under `prefix`; past that, `capMessage` is thrown with 429.
 */
export const issueLease = async (
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
	const rows = await leasesWith(payload, slug, [args.prefix, args.usedPrefix]);
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
			key: `${args.prefix}${leaseHandle(payload, id)}`,
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
export const claimLease = async (
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
 * The KV slug and key id of the request, which a call that stores a lease
 * needs. Throws where the endpoint would not offer one.
 */
export const leaseContext = (
	req: PayloadRequest,
): { slug: string; apiKeyId: DocumentId } => {
	const slug = leaseKvSlug(req.payload.config);
	const apiKeyId = req.context.mcpx?.apiKeyId;

	if (slug === undefined || apiKeyId === undefined) {
		throw new Error("A lease needs a database KV and a key.");
	}

	return { slug, apiKeyId };
};

/**
 * The data of `row` when it has not expired at `now`, otherwise `undefined`.
 */
export const unexpired = <T>(
	row: LeaseRow<T> | undefined,
	now: number,
): T | undefined => (row && expOf(row.data) > now ? row.data : undefined);
