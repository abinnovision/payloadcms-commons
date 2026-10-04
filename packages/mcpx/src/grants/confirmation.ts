import { ValidationError } from "payload";

import { expOf, GRANT_ID, issueRow, NO_REQ, rowsWith } from "./grant.js";
import { hashApiKey } from "../api-keys/key.js";
import { isPlainObject } from "../guards.js";

import type { KvRow } from "./grant.js";
import type { DocumentId } from "../entity.js";
import type { Payload } from "payload";

const CONFIRMATION_TTL_MS = 15 * 60 * 1000;

/**
 * Calls a key may have stored at a time, apart from its upload grants.
 */
export const CONFIRMATIONS_PER_KEY = 50;

// The hex HMAC the admin panel addresses an entry by.
const HANDLE = /^[\da-f]{64}$/;

export type ConfirmationState = "approved" | "pending" | "rejected";

/**
 * A call of a confirmable tool, stored until its key runs it.
 */
export interface Confirmation {
	apiKeyId: DocumentId;
	tool: string;
	args: Record<string, unknown>;
	/**
	 * The request's locale and fallback locale at issue, `null` when unset.
	 */
	locale: null | string;
	fallbackLocale: unknown;
	state: ConfirmationState;
	/**
	 * Epoch milliseconds.
	 */
	exp: number;
}

const entryPrefix = (apiKeyId: DocumentId): string =>
	`mcpx-confirmation:${String(apiKeyId)}:`;

const usedPrefix = (apiKeyId: DocumentId): string =>
	`mcpx-confirmation-used:${String(apiKeyId)}:`;

const asConfirmation = (
	row: KvRow | undefined,
	now: number,
): Confirmation | undefined =>
	row && isPlainObject(row.data) && expOf(row.data) > now
		? (row.data as unknown as Confirmation)
		: undefined;

/**
 * The handle the admin panel uses for the entry of `id`: its HMAC, which is
 * also what the row key holds.
 */
export const confirmationHandle = (payload: Payload, id: string): string =>
	hashApiKey(payload.secret, id);

/**
 * Stores a pending call and returns its id. A key may hold at most
 * {@link CONFIRMATIONS_PER_KEY} calls.
 */
export const issueConfirmation = async (
	payload: Payload,
	slug: string,
	call: Omit<Confirmation, "exp" | "state">,
): Promise<{ id: string; exp: number }> => {
	const entry: Omit<Confirmation, "exp"> = { ...call, state: "pending" };

	return await issueRow(payload, slug, {
		prefix: entryPrefix(call.apiKeyId),
		usedPrefix: usedPrefix(call.apiKeyId),
		cap: CONFIRMATIONS_PER_KEY,
		capMessage: `This key already has ${String(CONFIRMATIONS_PER_KEY)} calls waiting for approval. Run or abandon them first; each expires 15 minutes after it was requested.`,
		ttlMs: CONFIRMATION_TTL_MS,
		data: entry,
	});
};

/**
 * The unexpired call of `apiKeyId` with `id`, without claiming it. A call of
 * another key is `undefined`, as is a malformed id, before any database read.
 */
export const readConfirmation = async (
	payload: Payload,
	slug: string,
	apiKeyId: DocumentId,
	id: string,
): Promise<Confirmation | undefined> => {
	if (!GRANT_ID.test(id)) {
		return undefined;
	}

	const key = `${entryPrefix(apiKeyId)}${confirmationHandle(payload, id)}`;
	const rows = await rowsWith(payload, slug, [key]);

	return asConfirmation(
		rows.find((row) => row.key === key),
		Date.now(),
	);
};

/**
 * Marks the call used and removes it. The marker is a unique-key insert, so
 * of two concurrent claims exactly one returns `true`.
 */
export const claimConfirmation = async (
	payload: Payload,
	slug: string,
	apiKeyId: DocumentId,
	id: string,
	exp: number,
): Promise<boolean> => {
	const handle = confirmationHandle(payload, id);

	try {
		await payload.db.create({
			collection: slug,
			data: { key: `${usedPrefix(apiKeyId)}${handle}`, data: { exp } },
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
		where: { key: { equals: `${entryPrefix(apiKeyId)}${handle}` } },
		req: NO_REQ,
	});

	return true;
};

/**
 * Every unexpired call of `apiKeyId` with its handle, oldest first.
 */
export const listConfirmations = async (
	payload: Payload,
	slug: string,
	apiKeyId: DocumentId,
): Promise<{ handle: string; confirmation: Confirmation }[]> => {
	const prefix = entryPrefix(apiKeyId);
	const now = Date.now();

	return (await rowsWith(payload, slug, [prefix]))
		.flatMap((row) => {
			const confirmation = asConfirmation(row, now);

			return confirmation
				? [{ handle: row.key.slice(prefix.length), confirmation }]
				: [];
		})
		.sort((left, right) => left.confirmation.exp - right.confirmation.exp);
};

/**
 * Approves or rejects the pending calls of `apiKeyId` among `handles`, and
 * returns the handles it changed. A call that was decided, run or expired is
 * left alone and not returned.
 */
export const decideConfirmations = async (
	payload: Payload,
	slug: string,
	apiKeyId: DocumentId,
	handles: string[],
	state: Exclude<ConfirmationState, "pending">,
): Promise<string[]> => {
	const prefix = entryPrefix(apiKeyId);
	const keys = new Set(
		handles
			.filter((handle) => HANDLE.test(handle))
			.map((handle) => `${prefix}${handle}`),
	);

	if (keys.size === 0) {
		return [];
	}

	const now = Date.now();
	const decided: string[] = [];

	for (const row of await rowsWith(payload, slug, [prefix])) {
		const confirmation = asConfirmation(row, now);

		if (!keys.has(row.key) || confirmation?.state !== "pending") {
			continue;
		}

		/*
		 * Filtered on the stored state too, so a call claimed or decided since
		 * it was read is left alone and not reported.
		 */
		// eslint-disable-next-line no-await-in-loop
		const updated = await payload.db.updateMany({
			collection: slug,
			where: {
				and: [
					{ key: { equals: row.key } },
					{ "data.state": { equals: "pending" } },
				],
			},
			data: { data: { ...confirmation, state } },
			req: NO_REQ,
		});

		if (updated !== null && updated.length > 0) {
			decided.push(row.key.slice(prefix.length));
		}
	}

	return decided;
};
