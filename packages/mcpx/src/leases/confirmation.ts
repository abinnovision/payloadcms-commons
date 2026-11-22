import {
	claimLease,
	issuedTo,
	issueLease,
	LEASE_ID,
	leaseHandle,
	leasePrefixes,
	leasesWith,
	NO_REQ,
	unexpired,
} from "./lease.js";

import type { LeaseOwner, StoredCall } from "./lease.js";
import type { ConfirmationDecision } from "../api-keys/confirmation-view.js";
import type { Payload } from "payload";

const CONFIRMATION_TTL_MS = 15 * 60 * 1000;

/**
 * Calls a principal may have stored at a time, apart from its upload grants.
 */
export const CONFIRMATIONS_PER_PRINCIPAL = 50;

// The hex HMAC the admin panel addresses an entry by.
const HANDLE = /^[\da-f]{64}$/;

export type ConfirmationState = ConfirmationDecision | "pending";

/**
 * A call of a confirmable tool, stored until its principal runs it.
 */
export interface Confirmation extends StoredCall {
	state: ConfirmationState;
	/**
	 * Epoch milliseconds.
	 */
	exp: number;
}

/**
 * Stores a pending call and returns its id. A principal may hold at most
 * {@link CONFIRMATIONS_PER_PRINCIPAL} calls.
 */
export const issueConfirmation = async (
	payload: Payload,
	slug: string,
	call: Omit<Confirmation, "exp" | "state">,
): Promise<{ id: string; exp: number }> => {
	const entry: Omit<Confirmation, "exp"> = { ...call, state: "pending" };

	return await issueLease(payload, slug, {
		...leasePrefixes("confirmation", call.principal),
		cap: CONFIRMATIONS_PER_PRINCIPAL,
		capMessage: `This client already has ${String(CONFIRMATIONS_PER_PRINCIPAL)} calls waiting for approval. Run or abandon them first; each expires 15 minutes after it was requested.`,
		ttlMs: CONFIRMATION_TTL_MS,
		data: entry,
	});
};

/**
 * The unexpired call of `principal` with `id`, without claiming it. A call of
 * another principal is `undefined`, as is a malformed id, before any database
 * read.
 */
export const readConfirmation = async (
	payload: Payload,
	slug: string,
	principal: string,
	id: string,
): Promise<Confirmation | undefined> => {
	if (!LEASE_ID.test(id)) {
		return undefined;
	}

	const key = `${leasePrefixes("confirmation", principal).prefix}${leaseHandle(payload, id)}`;
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
	principal: string,
	id: string,
	exp: number,
): Promise<boolean> =>
	await claimLease(
		payload,
		slug,
		leasePrefixes("confirmation", principal),
		leaseHandle(payload, id),
		exp,
	);

/**
 * Every unexpired call of `principal` that `user` requested, with its handle,
 * oldest first.
 */
export const listConfirmations = async (
	payload: Payload,
	slug: string,
	principal: string,
	user: LeaseOwner["user"],
): Promise<{ handle: string; confirmation: Confirmation }[]> => {
	const { prefix } = leasePrefixes("confirmation", principal);
	const now = Date.now();

	return (await leasesWith<Confirmation>(payload, slug, [prefix]))
		.flatMap((row) => {
			const confirmation = unexpired(row, now);

			return confirmation && issuedTo(confirmation, user)
				? [{ handle: row.key.slice(prefix.length), confirmation }]
				: [];
		})
		.sort((left, right) => left.confirmation.exp - right.confirmation.exp);
};

/**
 * Approves or rejects the pending calls of `principal` that `user` requested
 * among `handles`, and returns the handles it changed. A call that was
 * decided, run or expired is left alone and not returned.
 */
export const decideConfirmations = async (
	payload: Payload,
	slug: string,
	owner: { principal: string; user: LeaseOwner["user"] },
	handles: string[],
	state: ConfirmationDecision,
): Promise<string[]> => {
	const { prefix } = leasePrefixes("confirmation", owner.principal);
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

		if (
			!keys.has(row.key) ||
			confirmation?.state !== "pending" ||
			!issuedTo(confirmation, owner.user)
		) {
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
