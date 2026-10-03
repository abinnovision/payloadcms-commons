import crypto from "node:crypto";
import { APIError, ValidationError } from "payload";

import { hashApiKey } from "../api-keys/key.js";
import { isPlainObject } from "../guards.js";

import type { DocumentId } from "../entity.js";
import type { KVAdapterResult, Payload, SanitizedConfig } from "payload";

const GRANT_TTL_MS = 5 * 60 * 1000;

const GRANTS_PER_KEY = 10;

// 32 random bytes in base64url.
const GRANT_ID = /^[\w-]{43}$/;

/*
 * The KV collection is only ever written through `payload.db`, which runs no
 * hooks and no access control. Without `req` no call joins a transaction, so a
 * rollback cannot undo a claim.
 */
const NO_REQ = {};

/**
 * A tool call waiting for its file, stored until the PUT that completes it.
 */
export interface UploadGrant {
	kind: "upload";
	apiKeyId: DocumentId;
	tool: string;
	args: Record<string, unknown>;
	/**
	 * The request's locale and fallback locale at issue, `null` when unset.
	 */
	locale: null | string;
	fallbackLocale: unknown;
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
	fallbackLocale: unknown;
	/**
	 * Epoch milliseconds.
	 */
	exp: number;
}

export type Grant = DownloadGrant | UploadGrant;

interface KvRow {
	key: string;
	data: unknown;
}

const grantPrefix = (apiKeyId: DocumentId): string =>
	`mcpx-grant:${String(apiKeyId)}:`;

const usedPrefix = (apiKeyId: DocumentId): string =>
	`mcpx-grant-used:${String(apiKeyId)}:`;

const expOf = (data: unknown): number =>
	isPlainObject(data) && typeof data["exp"] === "number" ? data["exp"] : 0;

/**
 * The KV collection slug, when Payload's database KV adapter backs it with a
 * unique `key`, which the single-use claim relies on. `undefined` otherwise.
 */
export const uploadKvSlug = (config: SanitizedConfig): string | undefined => {
	const kv = config.kv as KVAdapterResult | undefined;
	const key = kv?.kvCollection?.fields.find(
		(field) => "name" in field && field.name === "key",
	);

	return key && "unique" in key && key.unique
		? kv?.kvCollection?.slug
		: undefined;
};

const findRows = async (
	payload: Payload,
	slug: string,
	fragments: string[],
): Promise<KvRow[]> => {
	const { docs } = await payload.db.find({
		collection: slug,
		where: { or: fragments.map((fragment) => ({ key: { like: fragment } })) },
		limit: 0,
		pagination: false,
		req: NO_REQ,
	});

	return docs as unknown as KvRow[];
};

/**
 * Stores a grant and returns its id, the only copy of which goes to the
 * client. The row key holds the HMAC of the id. Expired rows of the same key
 * are purged first, and a key may hold at most {@link GRANTS_PER_KEY} grants.
 */
export const issueGrant = async (
	payload: Payload,
	slug: string,
	grant: Omit<DownloadGrant, "exp"> | Omit<UploadGrant, "exp">,
): Promise<{ grantId: string; exp: number }> => {
	const now = Date.now();
	const prefixes = [grantPrefix(grant.apiKeyId), usedPrefix(grant.apiKeyId)];
	// `like` matches a substring, so the prefix is checked again here.
	const rows = (await findRows(payload, slug, prefixes)).filter((row) =>
		prefixes.some((prefix) => row.key.startsWith(prefix)),
	);
	const expired = rows.filter((row) => expOf(row.data) <= now);

	if (expired.length > 0) {
		await payload.db.deleteMany({
			collection: slug,
			where: { key: { in: expired.map((row) => row.key) } },
			req: NO_REQ,
		});
	}

	const waiting = rows.filter(
		(row) => row.key.startsWith(prefixes[0]!) && expOf(row.data) > now,
	);

	if (waiting.length >= GRANTS_PER_KEY) {
		throw new APIError(
			`This key already has ${String(GRANTS_PER_KEY)} uploads or downloads waiting. Use or abandon them first; each expires 5 minutes after it was issued.`,
			429,
		);
	}

	const grantId = crypto.randomBytes(32).toString("base64url");
	const exp = now + GRANT_TTL_MS;

	await payload.db.create({
		collection: slug,
		data: {
			key: `${grantPrefix(grant.apiKeyId)}${hashApiKey(payload.secret, grantId)}`,
			data: { ...grant, exp },
		},
		req: NO_REQ,
	});

	return { grantId, exp };
};

/**
 * Loads the grant for `grantId` and marks it used, or returns `undefined` for
 * a malformed, unknown, expired or used one. The marker is a unique-key
 * insert, so of two concurrent claims exactly one succeeds. A malformed id
 * is refused before any database read.
 */
export const claimGrant = async (
	payload: Payload,
	slug: string,
	grantId: string,
): Promise<Grant | undefined> => {
	if (!GRANT_ID.test(grantId)) {
		return undefined;
	}

	const hash = hashApiKey(payload.secret, grantId);
	const row = (await findRows(payload, slug, [hash])).find(
		(candidate) =>
			candidate.key.startsWith("mcpx-grant:") &&
			candidate.key.endsWith(`:${hash}`),
	);
	const grant = row?.data as Grant | undefined;

	if (
		!row ||
		!isPlainObject(grant) ||
		row.key !== `${grantPrefix(grant.apiKeyId)}${hash}` ||
		expOf(grant) <= Date.now()
	) {
		return undefined;
	}

	try {
		await payload.db.create({
			collection: slug,
			data: {
				key: `${usedPrefix(grant.apiKeyId)}${hash}`,
				data: { exp: grant.exp },
			},
			req: NO_REQ,
		});
	} catch (error) {
		if (error instanceof ValidationError) {
			return undefined;
		}

		throw error;
	}

	await payload.db.deleteOne({
		collection: slug,
		where: { key: { equals: row.key } },
		req: NO_REQ,
	});

	return grant;
};
