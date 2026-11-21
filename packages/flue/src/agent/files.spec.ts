import { describe, expect, it } from "vitest";

import { FluePayloadError } from "./exchange.js";
import { downloadDocument } from "./files.js";

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

const rejection = async (promise: Promise<unknown>): Promise<unknown> =>
	await promise.then(
		() => undefined,
		(error: unknown) => error,
	);

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
	handle: "handle-1",
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
		expect(seen.headers.get("x-flue-handle")).toBe("handle-1");
		expect(seen.headers.get("range")).toBeNull();
	});

	it("asks for a range and takes the 206", async () => {
		const { fetch, seen } = fixed(
			() => new Response(BYTES.slice(2, 5), { status: 206 }),
		);
		const download = await downloadDocument(target(fetch), {
			collection: "docs",
			id: 3,
			range: { start: 2, end: 4 },
		});

		expect(seen.headers.get("range")).toBe("bytes=2-4");
		expect(new TextDecoder().decode(download.bytes)).toBe("234");
	});

	it("asks for an open range without an end", async () => {
		const { fetch, seen } = fixed(
			() => new Response(BYTES.slice(7), { status: 206 }),
		);
		const download = await downloadDocument(target(fetch), {
			collection: "docs",
			id: 3,
			range: { start: 7 },
		});

		expect(seen.headers.get("range")).toBe("bytes=7-");
		expect(new TextDecoder().decode(download.bytes)).toBe("789");
	});

	it("slices a whole-file 200 to the range and cancels the rest", async () => {
		const { fetch, seen } = fixed(
			(state) => new Response(largeBody(8 * MIB, state)),
		);
		const download = await downloadDocument(target(fetch), {
			collection: "docs",
			id: 3,
			range: { start: MIB - 2, end: MIB + 1 },
		});

		expect(download.bytes.byteLength).toBe(4);
		expect(seen.cancelled).toBe(true);
	});

	it("caps an open range of a whole-file 200 at maxBytes", async () => {
		const { fetch, seen } = fixed(
			(state) => new Response(largeBody(8 * MIB, state)),
		);
		const error = await rejection(
			downloadDocument(target(fetch), {
				collection: "docs",
				id: 3,
				range: { start: MIB },
				maxBytes: 2 * MIB,
			}),
		);

		expect(error).toMatchObject({ code: "too_large" });
		expect(seen.cancelled).toBe(true);
	});

	it.each([
		["a negative start", { start: -1 }],
		["a fractional start", { start: 1.5 }],
		["an end before the start", { start: 5, end: 4 }],
	])("refuses %s without a request", async (_label, range) => {
		const { fetch, seen } = fixed(() => new Response(BYTES));

		expect(
			await rejection(
				downloadDocument(target(fetch), { collection: "docs", id: 3, range }),
			),
		).toMatchObject({ code: "refused" });
		expect(seen.url).toBe("");
	});

	it("maps a refused download to its status", async () => {
		const { fetch } = fixed(() => new Response(null, { status: 403 }));

		expect(
			await rejection(
				downloadDocument(target(fetch), { collection: "docs", id: 3 }),
			),
		).toMatchObject({ name: "FluePayloadError", code: "refused", status: 403 });
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
		const exchangeError = new FluePayloadError("unauthorized", "refused", 401);

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
