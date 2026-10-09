import {
	claimLease,
	issueLease,
	LEASE_ID,
	leaseHandle,
	leasePrefixes,
	leasesWith,
	NO_REQ,
	unexpired,
} from "./lease.js";

import type { StoredCall } from "./lease.js";
import type { ConfirmationDecision } from "../api-keys/confirmation-view.js";
import type { DocumentId } from "../entity.js";
import type { Payload } from "payload";

const CONFIRMATION_TTL_MS = 15 * 60 * 1000;

/**
 * Calls a key may have stored at a time, apart from its upload grants.
 */
export const CONFIRMATIONS_PER_KEY = 50;

// The hex HMAC the admin panel addresses an entry by.
const HANDLE = /^[\da-f]{64}$/;

export type ConfirmationState = ConfirmationDecision | "pending";

/**
 * A call of a confirmable tool, stored until its key runs it.
 */
export interface Confirmation extends StoredCall {
	state: ConfirmationState;
	/**
	 * Epoch milliseconds.
	 */
	exp: number;
}

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

	return await issueLease(payload, slug, {
		...leasePrefixes("confirmation", call.apiKeyId),
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
	if (!LEASE_ID.test(id)) {
		return undefined;
	}

	const key = `${leasePrefixes("confirmation", apiKeyId).prefix}${leaseHandle(payload, id)}`;
	const rows = await leasesWith<Confirmation>(payload, slug, [key]);

	return unexpired(
		rows.find((row) => row.key === key),
		Date.now(),
	);
};

/**
 * Marks the call used and removes it. Of two concurrent claims exactly one
 * returns `true`.
 */
export const claimConfirmation = async (
	payload: Payload,
	slug: string,
	apiKeyId: DocumentId,
	id: string,
	exp: number,
): Promise<boolean> =>
	await claimLease(
		payload,
		slug,
		leasePrefixes("confirmation", apiKeyId),
		leaseHandle(payload, id),
		exp,
	);

/**
 * Every unexpired call of `apiKeyId` with its handle, oldest first.
 */
export const listConfirmations = async (
	payload: Payload,
	slug: string,
	apiKeyId: DocumentId,
): Promise<{ handle: string; confirmation: Confirmation }[]> => {
	const { prefix } = leasePrefixes("confirmation", apiKeyId);
	const now = Date.now();

	return (await leasesWith<Confirmation>(payload, slug, [prefix]))
		.flatMap((row) => {
			const confirmation = unexpired(row, now);

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
	state: ConfirmationDecision,
): Promise<string[]> => {
	const { prefix } = leasePrefixes("confirmation", apiKeyId);
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

	for (const row of await leasesWith<Confirmation>(payload, slug, [prefix])) {
		const confirmation = unexpired(row, now);

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
