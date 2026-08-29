import { commitTransaction, initTransaction, killTransaction } from "payload";

import type { PayloadRequest } from "payload";

/**
 * Adapters without transaction support, or a request that already owns one, run
 * `fn` as is.
 *
 * Atomicity, not isolation: neither SQLite nor Postgres at read committed locks
 * the row on the read, so an `expectedUpdatedAt` check remains best effort. Nor
 * is this safe across the tool calls of one JSON-RPC batch, which share a
 * request: the second caller joins the first's transaction, so one tool's
 * rollback takes the other's work with it.
 */
export const withTransaction = async <T>(
	req: PayloadRequest,
	fn: () => Promise<T>,
): Promise<T> => {
	const owns = await initTransaction(req);

	if (!owns) {
		return await fn();
	}

	try {
		const result = await fn();

		await commitTransaction(req);

		return result;
	} catch (error) {
		await killTransaction(req);

		throw error;
	}
};
