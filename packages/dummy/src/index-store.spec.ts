import { describe, expect, it, vi } from "vitest";

import { createIndexStore, describeUnresolved } from "./index-store.js";
import { dummyRef } from "./ref.js";

import type { Payload } from "payload";

/*
 * Only `find` is reached, and only to answer "is this key in the database".
 * A structural stub keeps this a unit spec; the real query is covered in
 * integration.
 */
const stub = (
	rows: Record<string, string> = {},
): { payload: Payload; calls: () => number } => {
	const find = vi.fn(
		(args: {
			collection: string;
			where: Record<string, { equals: unknown }>;
		}) => {
			const key = Object.values(args.where)[0]?.equals;
			const id = rows[`${args.collection}:${String(key)}`];

			return Promise.resolve({ docs: id === undefined ? [] : [{ id }] });
		},
	);

	return {
		payload: { find } as unknown as Payload,
		calls: () => find.mock.calls.length,
	};
};

const keyFor = (): string => "slug";

describe("createIndexStore", () => {
	it("answers what this run wrote, without a query", async () => {
		const { payload, calls } = stub();
		const store = createIndexStore(payload, keyFor);

		store.record("pages", "/", "p1");
		await store.warm([dummyRef("pages", "/")]);

		expect(store.get(dummyRef("pages", "/"))).toBe("p1");
		expect(calls()).toBe(0);
	});

	it("falls back to the database, so a skipped step still resolves", async () => {
		const store = createIndexStore(stub({ "pages:/": "p9" }).payload, keyFor);

		await store.warm([dummyRef("pages", "/")]);

		expect(store.get(dummyRef("pages", "/"))).toBe("p9");
	});

	it("answers undefined for a key nothing has written", async () => {
		const store = createIndexStore(stub().payload, keyFor);

		await store.warm([dummyRef("pages", "/")]);

		expect(store.get(dummyRef("pages", "/"))).toBeUndefined();
	});

	it("caches a hit but retries a miss, because a later seed may write it", async () => {
		const { payload, calls } = stub({ "pages:/": "p1" });
		const store = createIndexStore(payload, keyFor);

		await store.warm([dummyRef("pages", "/"), dummyRef("pages", "/gone")]);
		await store.warm([dummyRef("pages", "/"), dummyRef("pages", "/gone")]);

		// Three: both keys the first time, then only the miss the second.
		expect(calls()).toBe(3);
	});

	it("asks once for a key that appears twice in one walk", async () => {
		const { payload, calls } = stub();
		const store = createIndexStore(payload, keyFor);

		await store.warm([dummyRef("pages", "/"), dummyRef("pages", "/")]);

		expect(calls()).toBe(1);
	});

	it("knows which collections it wrote to", () => {
		const store = createIndexStore(stub().payload, keyFor);

		store.record("pages", "/", "p1");

		expect(store.touched("pages")).toBe(true);
		expect(store.touched("tags")).toBe(false);
		expect(store.keysIn("pages")).toEqual(["/"]);
	});
});

describe("describeUnresolved", () => {
	it("says no seed wrote to the collection when none did", () => {
		const store = createIndexStore(stub().payload, keyFor);

		expect(
			describeUnresolved(dummyRef("sections", "journal"), store),
		).toContain('no seed wrote to "sections"');
	});

	it("names the ref and the keys the collection does have", () => {
		const store = createIndexStore(stub().payload, keyFor);

		store.record("authors", "aerin", "1");
		store.record("authors", "alan", "2");

		const message = describeUnresolved(dummyRef("authors", "ada"), store);

		expect(message).toContain('authors:"ada"');
		expect(message).toContain('"authors" has: aerin, alan');
	});

	it("names three keys and counts the rest, so a large collection stays readable", () => {
		const store = createIndexStore(stub().payload, keyFor);

		for (const key of ["a", "b", "c", "d", "e"]) {
			store.record("authors", key, key);
		}

		expect(describeUnresolved(dummyRef("authors", "z"), store)).toContain(
			"has: a, b, c, and 2 more",
		);
	});
});
