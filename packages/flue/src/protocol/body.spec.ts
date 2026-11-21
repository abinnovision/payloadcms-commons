import { describe, expect, it } from "vitest";

import { readBytes } from "./body.js";

const text = (bytes: Uint8Array | undefined): string | undefined =>
	bytes && new TextDecoder().decode(bytes);

// A body of the given chunks that records whether it was read and cancelled.
const bodyOf = (chunks: string[]) => {
	const seen = { pulled: 0, cancelled: false };
	const queue = chunks.map((chunk) => new TextEncoder().encode(chunk));
	const stream = new ReadableStream<Uint8Array>({
		pull(controller) {
			const chunk = queue.shift();

			seen.pulled++;

			if (chunk) {
				controller.enqueue(chunk);
			} else {
				controller.close();
			}
		},
		cancel() {
			seen.cancelled = true;
		},
	});

	return { stream, seen };
};

describe("readBytes", () => {
	it("reads a whole body under the cap", async () => {
		const { stream } = bodyOf(["0123", "4567"]);

		expect(text(await readBytes(new Response(stream), 8))).toBe("01234567");
	});

	it("refuses a declared length over the cap unread", async () => {
		const { stream, seen } = bodyOf(["0123"]);
		const response = new Response(stream, {
			headers: { "content-length": "100" },
		});

		expect(await readBytes(response, 8)).toBeUndefined();
		expect(seen).toEqual({ pulled: 0, cancelled: true });
	});

	it("reads a range across chunk boundaries and cancels the rest", async () => {
		const { stream, seen } = bodyOf(["0123", "4567", "89ab", "cdef"]);

		expect(
			text(await readBytes(new Response(stream), 100, { start: 3, end: 9 })),
		).toBe("3456789");
		expect(seen.cancelled).toBe(true);
	});

	it("refuses a range past the cap", async () => {
		const { stream, seen } = bodyOf(["0123", "4567", "89ab"]);

		expect(
			await readBytes(new Response(stream), 4, { start: 2 }),
		).toBeUndefined();
		expect(seen.cancelled).toBe(true);
	});
});
