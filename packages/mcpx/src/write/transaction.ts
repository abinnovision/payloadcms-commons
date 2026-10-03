import { commitTransaction, initTransaction, killTransaction } from "payload";

import type { PayloadRequest } from "payload";

/**
 * Adapters without transaction support, or a request that already owns one,
 * run `fn` as is. This gives atomicity, not isolation: SQLite and Postgres at
 * read committed do not lock the row on read, so an `expectedUpdatedAt` check
 * stays best effort. Tool calls in one JSON-RPC batch run one after another, so
 * each owns its transaction and a rollback never undoes another call.
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
