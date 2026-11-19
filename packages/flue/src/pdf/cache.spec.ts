import { describe, expect, it } from "vitest";

import { DocumentCache } from "./cache.js";
import { FlueFileError } from "../agent/files.js";

interface Doc {
	name: string;
	closed: boolean;
}

const cache = (maxBytes: number): DocumentCache<Doc> =>
	new DocumentCache<Doc>(maxBytes, async (doc) => {
		doc.closed = true;

		await Promise.resolve();
	});

const doc = (name: string): Doc => ({ name, closed: false });

const read = async (
	documents: DocumentCache<Doc>,
	key: string,
	bytes: number,
	opened = doc(key),
): Promise<Doc> =>
	await documents.use(
		key,
		bytes,
		async () => await Promise.resolve(opened),
		async (found) => await Promise.resolve(found),
	);

describe("documentCache", () => {
	it("keeps an open document for the next call", async () => {
		const documents = cache(100);
		const first = await read(documents, "a", 40);

		expect(await read(documents, "a", 40, doc("other"))).toBe(first);
	});

	it("evicts the least recently used idle document by bytes", async () => {
		const documents = cache(100);
		const a = await read(documents, "a", 40);

		await read(documents, "b", 40);
		await read(documents, "a", 40);
		await read(documents, "c", 40);
		await Promise.resolve();

		expect(a.closed).toBe(false);
		expect(await read(documents, "a", 40, doc("again"))).toBe(a);
		expect((await read(documents, "b", 40, doc("again"))).name).toBe("again");
	});

	it("closes an evicted document", async () => {
		const documents = cache(100);
		const a = await read(documents, "a", 60);

		await read(documents, "b", 60);
		await Promise.resolve();

		expect(a.closed).toBe(true);
		expect((await read(documents, "a", 60, doc("again"))).name).toBe("again");
	});

	it("never evicts a document in use and refuses one that does not fit", async () => {
		const documents = cache(100);
		let release: () => void = () => undefined;
		const pinned = documents.use(
			"a",
			60,
			async () => await Promise.resolve(doc("a")),
			async (found) => {
				await new Promise<void>((resolve) => {
					release = resolve;
				});

				return found;
			},
		);

		await Promise.resolve();

		const refusal = await read(documents, "b", 60).catch(
			(error: unknown) => error,
		);

		expect(refusal).toBeInstanceOf(FlueFileError);
		expect((refusal as FlueFileError).code).toBe("unavailable");

		release();
		expect((await pinned).closed).toBe(false);
		expect((await read(documents, "b", 60)).name).toBe("b");
		expect((await read(documents, "a", 60, doc("again"))).name).toBe("again");
	});

	it("refuses a document that does not fit beside the pinned ones without evicting", async () => {
		const documents = cache(100);
		let release: () => void = () => undefined;

		const a = await read(documents, "a", 40);
		const pinned = documents.use(
			"b",
			60,
			async () => await Promise.resolve(doc("b")),
			async (found) => {
				await new Promise<void>((resolve) => {
					release = resolve;
				});

				return found;
			},
		);

		await Promise.resolve();

		const refusal = await read(documents, "c", 60).catch(
			(error: unknown) => error,
		);

		expect((refusal as FlueFileError).code).toBe("unavailable");

		release();
		await pinned;

		expect(await read(documents, "a", 40, doc("again"))).toBe(a);
	});

	it("opens a document once for concurrent calls while it loads", async () => {
		const documents = cache(100);
		let finish: (opened: Doc) => void = () => undefined;
		const loading = new Promise<Doc>((resolve) => {
			finish = resolve;
		});
		const use = async (): Promise<Doc> =>
			await documents.use(
				"a",
				40,
				async () => await loading,
				async (found) => await Promise.resolve(found),
			);
		const first = use();
		const second = use();

		finish(doc("a"));

		const [one, two] = await Promise.all([first, second]);

		expect(one).toBe(two);
	});

	it("releases a document once no call uses it", async () => {
		const released: string[] = [];
		const documents = new DocumentCache<Doc>(
			100,
			async () => {
				await Promise.resolve();
			},
			async (found) => {
				released.push(found.name);

				await Promise.resolve();
			},
		);

		await read(documents, "a", 40);
		await read(documents, "a", 40);

		expect(released).toEqual(["a", "a"]);
	});

	it("forgets a document that failed to open", async () => {
		const documents = cache(100);
		const failure = await documents
			.use(
				"a",
				40,
				async () => await Promise.reject(new Error("broken")),
				async (found) => await Promise.resolve(found),
			)
			.catch((error: unknown) => error);

		expect((failure as Error).message).toBe("broken");
		expect((await read(documents, "a", 40, doc("again"))).name).toBe("again");
	});
});
