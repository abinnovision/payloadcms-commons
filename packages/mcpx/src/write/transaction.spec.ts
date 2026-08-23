import { describe, expect, it, vi } from "vitest";

import { withTransaction } from "./transaction.js";

import type { PayloadRequest } from "payload";

const createReq = (
	db: Record<string, unknown>,
	transactionID?: string,
): PayloadRequest =>
	({
		payload: { db },
		...(transactionID === undefined ? {} : { transactionID }),
	}) as unknown as PayloadRequest;

describe("withTransaction", () => {
	it("begins, runs and commits when no transaction exists", async () => {
		const db = {
			beginTransaction: vi.fn(() => Promise.resolve("tx-1")),
			commitTransaction: vi.fn(() => Promise.resolve()),
			rollbackTransaction: vi.fn(() => Promise.resolve()),
		};
		const req = createReq(db);

		const result = await withTransaction(req, () => {
			expect(req.transactionID).toBe("tx-1");

			return Promise.resolve("done");
		});

		expect(result).toBe("done");
		expect(db.commitTransaction).toHaveBeenCalledWith("tx-1");
		expect(db.rollbackTransaction).not.toHaveBeenCalled();
		expect(req.transactionID).toBeUndefined();
	});

	it("rolls back and rethrows when the callback throws", async () => {
		const db = {
			beginTransaction: vi.fn(() => Promise.resolve("tx-2")),
			commitTransaction: vi.fn(() => Promise.resolve()),
			rollbackTransaction: vi.fn(() => Promise.resolve()),
		};
		const req = createReq(db);

		await expect(
			withTransaction(req, () => Promise.reject(new Error("boom"))),
		).rejects.toThrow("boom");

		expect(db.rollbackTransaction).toHaveBeenCalledWith("tx-2");
		expect(db.commitTransaction).not.toHaveBeenCalled();
	});

	it("runs the callback as is when the adapter has no transactions", async () => {
		const req = createReq({});

		await expect(withTransaction(req, () => Promise.resolve(1))).resolves.toBe(
			1,
		);
	});

	it("does not commit a transaction it does not own", async () => {
		const db = { commitTransaction: vi.fn(() => Promise.resolve()) };
		const req = createReq(db, "outer");

		await withTransaction(req, () => Promise.resolve());

		expect(db.commitTransaction).not.toHaveBeenCalled();
		expect(req.transactionID).toBe("outer");
	});
});
