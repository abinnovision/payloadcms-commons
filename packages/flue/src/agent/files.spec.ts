import { describe, expect, it } from "vitest";

import { FlueExchangeError } from "./exchange.js";
import { createFiles, downloadDocument, FlueFileError } from "./files.js";
import { FILE_LIMITS } from "../protocol/files.js";

const MIB = 1024 * 1024;
const BYTES = new TextEncoder().encode("0123456789");

interface Seen {
	url: string;
	headers: Headers;
	cancelled: boolean;
}

/*
 * A body of `size` bytes in 1 MiB chunks that records whether the reader
 * cancelled it before the end.
 */
const largeBody = (size: number, seen: Seen): ReadableStream<Uint8Array> => {
	let sent = 0;

	return new ReadableStream({
		pull(controller) {
			if (sent >= size) {
				controller.close();

				return;
			}

			const chunk = new Uint8Array(Math.min(MIB, size - sent));

			sent += chunk.byteLength;
			controller.enqueue(chunk);
		},
		cancel() {
			seen.cancelled = true;
		},
	});
};

// A fetch answering every request with one fixed response.
const fixed = (
	answer: (seen: Seen) => Response,
): { fetch: typeof globalThis.fetch; seen: Seen } => {
	const seen: Seen = { url: "", headers: new Headers(), cancelled: false };

	return {
		seen,
		fetch: async (input, init) => {
			const request = new Request(input, init);

			seen.url = request.url;
			seen.headers = request.headers;

			return await Promise.resolve(answer(seen));
		},
	};
};

const filesWith = (fetch: typeof globalThis.fetch) =>
	createFiles({
		payloadUrl: "http://payload.local/",
		fluePath: "/api/flue",
		secret: "secret",
		handle: "handle-1",
		agent: "editor",
		fetch,
	});

const rejection = async (promise: Promise<unknown>): Promise<unknown> =>
	await promise.then(
		() => undefined,
		(error: unknown) => error,
	);

describe("createFiles", () => {
	it("reads a file with the handle in a header, not the URL", async () => {
		const { fetch, seen } = fixed(() => new Response(BYTES));

		expect(await filesWith(fetch).read(42)).toEqual(BYTES);
		expect(seen.url).toBe("http://payload.local/api/flue/files/42");
		expect(seen.headers.get("x-flue-handle")).toBe("handle-1");
		expect(seen.headers.get("x-flue-agent")).toBe("editor");
		expect(seen.headers.get("authorization")).toBe("Bearer secret");
	});

	it("cancels the body once a read passes its cap", async () => {
		const { fetch, seen } = fixed(
			(state) => new Response(largeBody(4 * MIB, state)),
		);
		const error = await rejection(
			filesWith(fetch).read(1, { maxBytes: 2 * MIB }),
		);

		expect(error).toBeInstanceOf(FlueFileError);
		expect(error).toMatchObject({ code: "too_large" });
		expect(seen.cancelled).toBe(true);
	});

	it("caps a read at FILE_LIMITS.readBytes by default", async () => {
		const { fetch, seen } = fixed(
			(state) =>
				new Response(largeBody(FILE_LIMITS.readBytes + 4 * MIB, state)),
		);

		expect(await rejection(filesWith(fetch).read(1))).toMatchObject({
			code: "too_large",
		});
		expect(seen.cancelled).toBe(true);
	});

	it("passes a 206 through", async () => {
		const { fetch, seen } = fixed(
			() => new Response(BYTES.slice(2, 5), { status: 206 }),
		);
		const response = await filesWith(fetch).fetch(1, {
			range: { start: 2, end: 4 },
		});

		expect(seen.headers.get("range")).toBe("bytes=2-4");
		expect(response.status).toBe(206);
		expect(await response.text()).toBe("234");
	});

	it("slices a whole-file 200 to the range and cancels the rest", async () => {
		const { fetch, seen } = fixed(
			(state) =>
				new Response(largeBody(8 * MIB, state), {
					headers: { "content-type": "application/pdf" },
				}),
		);
		const response = await filesWith(fetch).fetch(1, {
			range: { start: MIB - 2, end: MIB + 1 },
		});

		expect(response.status).toBe(206);
		expect(response.headers.get("content-type")).toBe("application/pdf");
		expect(response.headers.get("content-range")).toBe(
			`bytes ${String(MIB - 2)}-${String(MIB + 1)}/*`,
		);
		expect((await response.arrayBuffer()).byteLength).toBe(4);
		expect(seen.cancelled).toBe(true);
	});

	it("refuses a range starting past the end of a whole-file 200", async () => {
		const { fetch } = fixed(() => new Response(BYTES));

		expect(
			await rejection(
				filesWith(fetch).fetch(1, { range: { start: 20, end: 29 } }),
			),
		).toMatchObject({ code: "refused", status: 416 });
	});

	it.each([
		[404, "not_found"],
		[401, "refused"],
		[502, "unavailable"],
	])("maps status %i to %s", async (status, code) => {
		const { fetch } = fixed(() => new Response(null, { status }));
		const files = filesWith(fetch);

		expect(await rejection(files.read(1))).toMatchObject({ code, status });
		expect(await rejection(files.list())).toMatchObject({ code, status });
	});

	it("lists the thread's files", async () => {
		const listed = [
			{
				id: 1,
				name: "a.txt",
				mimeType: "text/plain",
				size: 3,
				createdAt: "2026-11-19T00:00:00.000Z",
			},
		];
		const { fetch, seen } = fixed(() => Response.json(listed));

		expect(await filesWith(fetch).list()).toEqual(listed);
		expect(seen.url).toBe("http://payload.local/api/flue/files/list");
	});
});

const HANDOFF = {
	filename: "brief.pdf",
	mimeType: "application/pdf",
	download: {
		url: "https://cms.example.com/api/mcpx/file",
		headers: { "x-mcpx-grant": "grant" },
	},
};

const target = (fetch: typeof globalThis.fetch, doc: unknown = HANDOFF) => ({
	session: { callTool: async () => await Promise.resolve(doc) },
	payloadUrl: "http://payload.local",
	mcpPath: "/api/mcpx",
	fetch,
});

describe("downloadDocument", () => {
	it("fetches the handoff below payloadUrl with its headers", async () => {
		const { fetch, seen } = fixed(() => new Response(BYTES));

		expect(
			await downloadDocument(target(fetch), { collection: "docs", id: 3 }),
		).toEqual({
			filename: "brief.pdf",
			mimeType: "application/pdf",
			bytes: BYTES,
		});
		expect(seen.url).toBe("http://payload.local/api/mcpx/file");
		expect(seen.headers.get("x-mcpx-grant")).toBe("grant");
	});

	it("stops at its 32 MiB default", async () => {
		const { fetch, seen } = fixed(
			(state) => new Response(largeBody(40 * MIB, state)),
		);
		const error = await rejection(
			downloadDocument(target(fetch), { collection: "docs", id: 3 }),
		);

		expect(error).toMatchObject({ code: "too_large" });
		expect(seen.cancelled).toBe(true);
	});

	it("refuses a handoff outside the mcpx file route without fetching", async () => {
		const { fetch, seen } = fixed(() => new Response(BYTES));
		const error = await rejection(
			downloadDocument(
				target(fetch, {
					...HANDOFF,
					download: { ...HANDOFF.download, url: "https://evil.example/x" },
				}),
				{ collection: "docs", id: 3 },
			),
		);

		expect(error).toMatchObject({ code: "refused" });
		expect(seen.url).toBe("");
	});

	it("answers not_found for a document without a file", async () => {
		const { fetch } = fixed(() => new Response(BYTES));

		expect(
			await rejection(
				downloadDocument(target(fetch, { id: 3 }), {
					collection: "docs",
					id: 3,
				}),
			),
		).toMatchObject({ code: "not_found" });
	});

	it("passes exchange errors through", async () => {
		const { fetch } = fixed(() => new Response(BYTES));
		const exchangeError = new FlueExchangeError("refused", 401);

		expect(
			await rejection(
				downloadDocument(
					{
						...target(fetch),
						session: {
							callTool: async () => await Promise.reject(exchangeError),
						},
					},
					{ collection: "docs", id: 3 },
				),
			),
		).toBe(exchangeError);
	});
});
