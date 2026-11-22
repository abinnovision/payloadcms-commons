import { describe, expect, it } from "vitest";

import { exchangeKey, exchangeSession, FluePayloadError } from "./exchange.js";

import type { ExchangeResponse } from "../protocol/exchange.js";

const SECRET = "sidecar-secret-0123456789abcdefghijklmnop";
const HANDLE = "handle-9f8e7d6c5b4a";
const PAYLOAD_URL = "https://cms.example.com/";
const EXCHANGE_URL = "https://cms.example.com/api/flue/exchange";
const MCP_URL = "https://cms.example.com/api/mcpx";
const IN_AN_HOUR = new Date(Date.now() + 60 * 60_000).toISOString();

const exchanged = (
	key: string,
	mcpPath = "/api/mcpx",
	expiresAt = IN_AN_HOUR,
): ExchangeResponse => ({
	key,
	mcpPath,
	expiresAt,
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
		"maps status %i to a FluePayloadError with that status",
		async (status) => {
			const { fetch } = recordingFetch(() => new Response(null, { status }));

			await expect(exchangeKey(args(fetch))).rejects.toMatchObject({
				name: "FluePayloadError",
				status,
			});
		},
	);

	it("maps a network failure to a FluePayloadError without a status", async () => {
		const fetch = (): Promise<Response> =>
			Promise.reject(new TypeError("fetch failed"));

		await expect(exchangeKey(args(fetch))).rejects.toMatchObject({
			name: "FluePayloadError",
			status: undefined,
		});
	});

	it("refuses an answer without a key", async () => {
		const { fetch } = recordingFetch(() => Response.json({ mcpPath: "/x" }));

		await expect(exchangeKey(args(fetch))).rejects.toBeInstanceOf(
			FluePayloadError,
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

			expect(error).toBeInstanceOf(FluePayloadError);
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

	it("passes transport requests on with their headers", async () => {
		const { requests, fetch } = recordingFetch(() => new Response(null));
		const session = exchangeSession({ ...args(fetch), mcpPath: "/api/mcpx" });

		await session.fetch(MCP_URL, {
			method: "POST",
			headers: { authorization: "Bearer key-1" },
		});
		await session.fetch(
			new Request(MCP_URL, { headers: { "mcp-session-id": "s1" } }),
		);

		expect(requests[0]?.headers.get("authorization")).toBe("Bearer key-1");
		expect(requests[1]?.url).toBe(MCP_URL);
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

	it("exchanges again when the cached token has less than two minutes left", async () => {
		const inAMinute = new Date(Date.now() + 60_000).toISOString();
		const answers = [
			exchanged("token-1", "/api/mcpx", inAMinute),
			exchanged("token-2"),
		];
		const { requests, fetch } = recordingFetch(() =>
			Response.json(answers.shift()),
		);
		const session = exchangeSession({ ...args(fetch), mcpPath: "/api/mcpx" });

		await expect(session.auth()).resolves.toBe("token-1");
		await expect(session.auth()).resolves.toBe("token-2");
		await expect(session.auth()).resolves.toBe("token-2");
		expect(requests).toHaveLength(2);
	});

	it("keeps a renewed token that expires no later than the last one until a 401", async () => {
		const inAMinute = new Date(Date.now() + 60_000).toISOString();
		const answers = [
			exchanged("token-1", "/api/mcpx", inAMinute),
			exchanged("token-2", "/api/mcpx", inAMinute),
			exchanged("token-3"),
		];
		const { requests, fetch } = recordingFetch(() =>
			Response.json(answers.shift()),
		);
		const session = exchangeSession({ ...args(fetch), mcpPath: "/api/mcpx" });

		await expect(session.auth()).resolves.toBe("token-1");
		await expect(session.auth()).resolves.toBe("token-2");
		await expect(session.auth()).resolves.toBe("token-2");
		expect(requests).toHaveLength(2);
	});

	it("refuses a Payload that serves mcpx at another path", async () => {
		const { fetch } = recordingFetch(() =>
			Response.json(exchanged("key-1", "/cms-api/mcpx")),
		);
		const session = exchangeSession({ ...args(fetch), mcpPath: "/api/mcpx" });

		await expect(session.auth()).rejects.toMatchObject({
			name: "FluePayloadError",
			status: undefined,
			message:
				'[payloadcms-flue] Payload serves mcpx at "/cms-api/mcpx", not at the configured "/api/mcpx".',
		});
	});
});

describe("exchangeSession.callTool", () => {
	const toolAnswer = (result: unknown): Response =>
		Response.json({ jsonrpc: "2.0", id: 1, result });

	it("posts one tools/call with the exchanged key and resolves the parsed text", async () => {
		const { requests, fetch } = recordingFetch((url) =>
			url === MCP_URL
				? toolAnswer({ content: [{ type: "text", text: '{"id":4}' }] })
				: Response.json(exchanged("key-1")),
		);
		const session = exchangeSession({ ...args(fetch), mcpPath: "/api/mcpx" });

		await expect(
			session.callTool("createDocument", { collection: "files" }),
		).resolves.toEqual({ id: 4 });

		const calls = requests.filter((r) => r.url === MCP_URL);

		expect(calls).toHaveLength(1);
		expect(calls[0]?.method).toBe("POST");
		expect(calls[0]?.headers.get("authorization")).toBe("Bearer key-1");
		expect(calls[0]?.headers.get("accept")).toBe(
			"application/json, text/event-stream",
		);
		expect(calls[0]?.body).toEqual({
			jsonrpc: "2.0",
			id: 1,
			method: "tools/call",
			params: { name: "createDocument", arguments: { collection: "files" } },
		});
	});

	it("prefers the structured content", async () => {
		const { fetch } = recordingFetch((url) =>
			url === MCP_URL
				? toolAnswer({
						content: [{ type: "text", text: "ignored" }],
						structuredContent: { id: 5 },
					})
				: Response.json(exchanged("key-1")),
		);
		const session = exchangeSession({ ...args(fetch), mcpPath: "/api/mcpx" });

		await expect(session.callTool("getDocument", {})).resolves.toEqual({
			id: 5,
		});
	});

	it("exchanges again and retries once after a 401", async () => {
		const keys = ["key-1", "key-2"];
		const answers = [
			new Response(null, { status: 401 }),
			toolAnswer({ content: [{ type: "text", text: '{"ok":true}' }] }),
		];
		const { requests, fetch } = recordingFetch((url) =>
			url === MCP_URL
				? (answers.shift() ?? new Response(null, { status: 500 }))
				: Response.json(exchanged(keys.shift() ?? "none")),
		);
		const session = exchangeSession({ ...args(fetch), mcpPath: "/api/mcpx" });

		await expect(session.callTool("getDocument", {})).resolves.toEqual({
			ok: true,
		});
		expect(
			requests
				.filter((r) => r.url === MCP_URL)
				.map((r) => r.headers.get("authorization")),
		).toEqual(["Bearer key-1", "Bearer key-2"]);
	});

	it("throws after a second 401", async () => {
		const { fetch } = recordingFetch((url) =>
			url === MCP_URL
				? new Response(null, { status: 401 })
				: Response.json(exchanged("key-1")),
		);
		const session = exchangeSession({ ...args(fetch), mcpPath: "/api/mcpx" });

		await expect(session.callTool("getDocument", {})).rejects.toMatchObject({
			name: "FluePayloadError",
			code: "unauthorized",
			message: '[payloadcms-flue] mcpx answered "getDocument" with status 401.',
		});
	});

	it("throws the tool's error message when the result is an error", async () => {
		const { fetch } = recordingFetch((url) =>
			url === MCP_URL
				? toolAnswer({
						content: [
							{ type: "text", text: '{"error":"Nothing was created."}' },
						],
						isError: true,
					})
				: Response.json(exchanged("key-1")),
		);
		const session = exchangeSession({ ...args(fetch), mcpPath: "/api/mcpx" });

		await expect(session.callTool("createDocument", {})).rejects.toThrow(
			'[payloadcms-flue] "createDocument" failed: Nothing was created.',
		);
	});

	it("throws a JSON-RPC error", async () => {
		const { fetch } = recordingFetch((url) =>
			url === MCP_URL
				? Response.json({
						jsonrpc: "2.0",
						id: 1,
						error: { code: -32602, message: "Invalid params" },
					})
				: Response.json(exchanged("key-1")),
		);
		const session = exchangeSession({ ...args(fetch), mcpPath: "/api/mcpx" });

		await expect(session.callTool("createDocument", {})).rejects.toThrow(
			'[payloadcms-flue] mcpx refused "createDocument": Invalid params',
		);
	});
});

describe("exchangeSession.request", () => {
	const REST_URL = "https://cms.example.com/api/pages?limit=1";

	it("requests a path below the Payload URL with the token as bearer", async () => {
		const { requests, fetch } = recordingFetch((url) =>
			url === EXCHANGE_URL
				? Response.json(exchanged("token-1"))
				: Response.json({ docs: [] }),
		);
		const session = exchangeSession({ ...args(fetch), mcpPath: "/api/mcpx" });
		const response = await session.request("/api/pages?limit=1", {
			headers: { accept: "application/json" },
		});

		expect(await response.json()).toEqual({ docs: [] });
		expect(requests[1]?.url).toBe(REST_URL);
		expect(requests[1]?.headers.get("authorization")).toBe("Bearer token-1");
		expect(requests[1]?.headers.get("accept")).toBe("application/json");
	});

	it("exchanges again and retries once after a 401", async () => {
		const tokens = ["token-1", "token-2"];
		const { requests, fetch } = recordingFetch((url) =>
			url === EXCHANGE_URL
				? Response.json(exchanged(tokens.shift() ?? "none"))
				: new Response(null, { status: 401 }),
		);
		const session = exchangeSession({ ...args(fetch), mcpPath: "/api/mcpx" });
		const response = await session.request("/api/pages");

		expect(response.status).toBe(401);
		expect(
			requests
				.filter((request) => request.url !== EXCHANGE_URL)
				.map((request) => request.headers.get("authorization")),
		).toEqual(["Bearer token-1", "Bearer token-2"]);
	});

	it("refuses a path that does not start with a slash and sends nothing", async () => {
		const { requests, fetch } = recordingFetch(() =>
			Response.json(exchanged("token-1")),
		);
		const session = exchangeSession({ ...args(fetch), mcpPath: "/api/mcpx" });

		await expect(
			session.request("https://evil.example/steal"),
		).rejects.toBeInstanceOf(FluePayloadError);
		expect(requests).toEqual([]);
	});
});
