import { describe, expect, it } from "vitest";

import { exchangeKey, exchangeSession, FlueExchangeError } from "./exchange.js";

import type { ExchangeResponse } from "../protocol/exchange.js";

const SECRET = "sidecar-secret-0123456789abcdefghijklmnop";
const HANDLE = "handle-9f8e7d6c5b4a";
const PAYLOAD_URL = "https://cms.example.com/";
const EXCHANGE_URL = "https://cms.example.com/api/flue/exchange";
const MCP_URL = "https://cms.example.com/api/mcpx";

const exchanged = (key: string, mcpPath = "/api/mcpx"): ExchangeResponse => ({
	key,
	mcpPath,
	expiresAt: "2026-11-07T12:00:00.000Z",
	user: { collection: "users", id: 1 },
	thread: 7,
	kind: "chat",
});

interface Recorded {
	url: string;
	method: string | undefined;
	headers: Headers;
	body: unknown;
}

/** A fetch that records each request and answers from `respond`. */
const recordingFetch = (respond: (url: string) => Response) => {
	const requests: Recorded[] = [];

	const fetch = (input: RequestInfo | URL, init?: RequestInit) => {
		const url = input instanceof Request ? input.url : String(input);
		const body: unknown =
			typeof init?.body === "string" ? JSON.parse(init.body) : undefined;

		requests.push({
			url,
			method: init?.method,
			headers: new Headers(init?.headers),
			body,
		});

		return Promise.resolve(respond(url));
	};

	return { requests, fetch };
};

const args = (fetch: typeof globalThis.fetch) => ({
	payloadUrl: PAYLOAD_URL,
	fluePath: "/api/flue",
	secret: SECRET,
	handle: HANDLE,
	agent: "editor",
	fetch,
});

describe("exchangeKey", () => {
	it("posts the handle and agent with the bearer secret", async () => {
		const { requests, fetch } = recordingFetch(() =>
			Response.json(exchanged("key-1")),
		);

		await expect(exchangeKey(args(fetch))).resolves.toEqual(exchanged("key-1"));
		expect(requests).toHaveLength(1);
		expect(requests[0]?.url).toBe(EXCHANGE_URL);
		expect(requests[0]?.method).toBe("POST");
		expect(requests[0]?.headers.get("authorization")).toBe(`Bearer ${SECRET}`);
		expect(requests[0]?.headers.get("content-type")).toBe("application/json");
		expect(requests[0]?.body).toEqual({ handle: HANDLE, agent: "editor" });
	});

	it.each([401, 404, 500])(
		"maps status %i to a FlueExchangeError with that status",
		async (status) => {
			const { fetch } = recordingFetch(() => new Response(null, { status }));

			await expect(exchangeKey(args(fetch))).rejects.toMatchObject({
				name: "FlueExchangeError",
				status,
			});
		},
	);

	it("maps a network failure to a FlueExchangeError without a status", async () => {
		const fetch = (): Promise<Response> =>
			Promise.reject(new TypeError("fetch failed"));

		await expect(exchangeKey(args(fetch))).rejects.toMatchObject({
			name: "FlueExchangeError",
			status: undefined,
		});
	});

	it("refuses an answer without a key", async () => {
		const { fetch } = recordingFetch(() => Response.json({ mcpPath: "/x" }));

		await expect(exchangeKey(args(fetch))).rejects.toBeInstanceOf(
			FlueExchangeError,
		);
	});

	it.each([
		["401", () => new Response(null, { status: 401 })],
		["404", () => new Response(null, { status: 404 })],
		["502", () => new Response("upstream", { status: 502 })],
		["no key", () => Response.json({})],
	])(
		"leaves the secret and the handle out of the message (%s)",
		async (_, respond) => {
			const { fetch } = recordingFetch(respond);
			const error: unknown = await exchangeKey(args(fetch)).catch(
				(caught: unknown) => caught,
			);

			expect(error).toBeInstanceOf(FlueExchangeError);
			expect(String(error)).not.toContain(SECRET);
			expect(String(error)).not.toContain(HANDLE);
		},
	);
});

describe("exchangeSession", () => {
	it("builds the mcpx URL below the Payload URL", () => {
		const { fetch } = recordingFetch(() => Response.json(exchanged("key-1")));

		expect(exchangeSession({ ...args(fetch), mcpPath: "/api/mcpx" }).url).toBe(
			MCP_URL,
		);
	});

	it("exchanges on first use and serves the key from then on", async () => {
		const { requests, fetch } = recordingFetch(() =>
			Response.json(exchanged("key-1")),
		);
		const session = exchangeSession({ ...args(fetch), mcpPath: "/api/mcpx" });

		expect(requests).toEqual([]);
		await expect(session.auth()).resolves.toBe("key-1");
		await expect(session.auth()).resolves.toBe("key-1");
		await expect(session.exchange()).resolves.toMatchObject({ thread: 7 });
		expect(requests.map((r) => r.url)).toEqual([EXCHANGE_URL]);
	});

	it("exchanges again after mcpx answers 401", async () => {
		const keys = ["key-1", "key-2"];
		const { fetch } = recordingFetch((url) =>
			url === MCP_URL
				? new Response(null, { status: 401 })
				: Response.json(exchanged(keys.shift() ?? "none")),
		);
		const session = exchangeSession({ ...args(fetch), mcpPath: "/api/mcpx" });

		await expect(session.auth()).resolves.toBe("key-1");
		await session.fetch(MCP_URL, { method: "POST" });
		await expect(session.auth()).resolves.toBe("key-2");
	});

	it("exchanges again after a failed exchange", async () => {
		const answers = [
			new Response(null, { status: 404 }),
			Response.json(exchanged("key-1")),
		];
		const { fetch } = recordingFetch(
			() => answers.shift() ?? new Response(null, { status: 500 }),
		);
		const session = exchangeSession({ ...args(fetch), mcpPath: "/api/mcpx" });

		await expect(session.auth()).rejects.toMatchObject({ status: 404 });
		await expect(session.auth()).resolves.toBe("key-1");
	});

	it("refuses a Payload that serves mcpx at another path", async () => {
		const { fetch } = recordingFetch(() =>
			Response.json(exchanged("key-1", "/cms-api/mcpx")),
		);
		const session = exchangeSession({ ...args(fetch), mcpPath: "/api/mcpx" });

		await expect(session.auth()).rejects.toMatchObject({
			name: "FlueExchangeError",
			status: undefined,
			message:
				'[payloadcms-flue] Payload serves mcpx at "/cms-api/mcpx", not at the configured "/api/mcpx".',
		});
	});
});
