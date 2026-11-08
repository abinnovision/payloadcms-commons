import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { conversationSnapshot, subscribeConversation } from "./conversation.js";
import { fixture } from "../../test/builders/fixtures.js";

const HISTORY = fixture("flue-history.json");
const OFFSET = (JSON.parse(HISTORY) as { offset: string }).offset;

interface Seen {
	view: null | string;
	live: null | string;
	signal: AbortSignal | undefined;
}

/*
 * The plugin's conversation route as the SDK reads it: the recorded history,
 * then an empty page, and a long poll that waits until it is cancelled.
 */
const serve = (): Seen[] => {
	const seen: Seen[] = [];

	vi.stubGlobal(
		"fetch",
		(input: Request | string | URL, init?: RequestInit) => {
			const request = input instanceof Request ? input : undefined;
			const url = new URL(request?.url ?? (input as string | URL));
			const signal = init?.signal ?? request?.signal ?? undefined;
			const view = url.searchParams.get("view");
			const live = url.searchParams.get("live");

			seen.push({ view, live, signal });

			const headers = {
				"content-type": "application/json",
				"stream-next-offset": OFFSET,
				"stream-up-to-date": "true",
			};

			if (view === "history") {
				return Promise.resolve(new Response(HISTORY, { headers }));
			}

			if (live === null) {
				return Promise.resolve(new Response("[]", { headers }));
			}

			return new Promise<Response>((_resolve, reject) => {
				signal?.addEventListener("abort", () => {
					reject(new DOMException("aborted", "AbortError"));
				});
			});
		},
	);

	return seen;
};

const waiting = (seen: Seen[]): Seen[] =>
	seen.filter((request) => request.live === "long-poll");

let url: string;
let sequence = 0;

beforeEach(() => {
	// Observations are shared per URL for the module's lifetime.
	sequence += 1;
	url = `https://cms.example.com/api/flue/c/${String(sequence)}`;
});

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("subscribeConversation", () => {
	it("hydrates the conversation and follows it by long-polling", async () => {
		const seen = serve();
		const unsubscribe = subscribeConversation(url, () => undefined);

		await vi.waitFor(() => {
			expect(conversationSnapshot(url).phase).toBe("live");
			expect(waiting(seen)).toHaveLength(1);
		});

		expect(conversationSnapshot(url).conversation?.messages).toHaveLength(2);

		unsubscribe();
	});

	it("shares one observation among the subscribers of a URL", async () => {
		const seen = serve();
		const first = vi.fn();
		const second = vi.fn();
		const unsubscribeFirst = subscribeConversation(url, first);
		const unsubscribeSecond = subscribeConversation(url, second);

		await vi.waitFor(() => {
			expect(waiting(seen)).toHaveLength(1);
		});

		expect(seen.filter((request) => request.view === "history")).toHaveLength(
			1,
		);
		expect(first).toHaveBeenCalled();
		expect(second).toHaveBeenCalled();

		unsubscribeFirst();
		unsubscribeSecond();
	});

	it("closes the observation with its last subscriber", async () => {
		const seen = serve();
		const unsubscribeFirst = subscribeConversation(url, () => undefined);
		const unsubscribeSecond = subscribeConversation(url, () => undefined);

		await vi.waitFor(() => {
			expect(waiting(seen)).toHaveLength(1);
		});

		unsubscribeFirst();

		expect(waiting(seen)[0]?.signal?.aborted).toBe(false);
		expect(conversationSnapshot(url).phase).toBe("live");

		unsubscribeSecond();

		expect(waiting(seen)[0]?.signal?.aborted).toBe(true);
		expect(conversationSnapshot(url).phase).toBe("loading");
	});

	it("follows the conversation again after a subscribe, unsubscribe and subscribe in a row", async () => {
		const seen = serve();
		const listener = vi.fn();

		subscribeConversation(url, () => undefined)();

		const unsubscribe = subscribeConversation(url, listener);

		await vi.waitFor(() => {
			expect(conversationSnapshot(url).phase).toBe("live");
			expect(waiting(seen)).toHaveLength(1);
		});

		expect(listener).toHaveBeenCalled();
		expect(waiting(seen)[0]?.signal?.aborted).toBe(false);

		unsubscribe();

		expect(waiting(seen).every((request) => request.signal?.aborted)).toBe(
			true,
		);
	});
});
