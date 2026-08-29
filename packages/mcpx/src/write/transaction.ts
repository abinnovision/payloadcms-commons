import { commitTransaction, initTransaction, killTransaction } from "payload";

import type { PayloadRequest } from "payload";

/**
 * Runs `fn` inside one database transaction on `req`, so a read followed by a
 * write cannot interleave with another writer. Adapters without transaction
 * support, or a request that already owns one, run `fn` as is.
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
