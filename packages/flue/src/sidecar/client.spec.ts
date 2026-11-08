import { afterEach, describe, expect, it, vi } from "vitest";

import { createSidecarClient, SidecarError } from "./client.js";
import { fixture } from "../../test/builders/fixtures.js";

const SECRET = "sidecar-secret-0123456789abcdefghijklmnop";
const CONVERSATION = "conv/one";
const BASE = "http://sidecar.internal:3101";
const CONVERSATION_URL = `${BASE}/agents/editor/conv%2Fone`;

interface Recorded {
	url: string;
	method: string | undefined;
	headers: Headers;
	body: unknown;
	signal: AbortSignal | null | undefined;
}

/** A fetch that records each request and answers from `respond`. */
const recordingFetch = (respond: () => Response) => {
	const requests: Recorded[] = [];

	const fetch = (input: RequestInfo | URL, init?: RequestInit) => {
		requests.push({
			url: input instanceof Request ? input.url : String(input),
			method: init?.method,
			headers: new Headers(init?.headers),
			body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
			signal: init?.signal,
		});

		return Promise.resolve(respond());
	};

	return {
		requests,
		client: createSidecarClient({ url: `${BASE}/`, secret: SECRET, fetch }),
	};
};

// A fetch that answers only by failing once its signal aborts, as fetch does.
const hangingFetch = (_input: RequestInfo | URL, init?: RequestInit) =>
	new Promise<Response>((_resolve, reject) => {
		const fail = () => {
			reject(init?.signal?.reason as Error);
		};

		if (init?.signal?.aborted) {
			fail();
		}

		init?.signal?.addEventListener("abort", fail);
	});

const MESSAGE = {
	kind: "signal",
	type: "payload-context",
	body: "Hello",
	attributes: { turn: "user" },
} as const;

describe("createSidecarClient", () => {
	it("posts one message with initialData and returns the submission", async () => {
		const { requests, client } = recordingFetch(() =>
			Response.json(
				{ streamUrl: "/x", offset: "0_1", submissionId: "sub_1", uid: "u" },
				{ status: 202 },
			),
		);

		await expect(
			client.send("editor", CONVERSATION, {
				message: MESSAGE,
				initialData: { flue: { handle: "h" } },
			}),
		).resolves.toEqual({ offset: "0_1", submissionId: "sub_1", uid: "u" });

		expect(requests).toEqual([
			{
				url: CONVERSATION_URL,
				method: "POST",
				headers: new Headers({
					accept: "application/json",
					"content-type": "application/json",
					authorization: `Bearer ${SECRET}`,
				}),
				body: {
					...MESSAGE,
					initialData: { flue: { handle: "h" } },
				},
				signal: expect.any(AbortSignal),
			},
		]);
	});

	it("leaves uid and initialData out when unset", async () => {
		const { requests, client } = recordingFetch(() =>
			Response.json(
				{ offset: "0_1", submissionId: "sub_1", uid: "u" },
				{ status: 202 },
			),
		);

		await client.send("editor", CONVERSATION, { message: MESSAGE });

		expect(requests[0]?.body).toEqual(MESSAGE);
	});

	it("reads history and answers undefined for a conversation Flue has not seen", async () => {
		const body = fixture("flue-history.json");
		const unknown = JSON.parse(fixture("flue-history-unknown.json")) as {
			status: number;
			body: unknown;
		};
		const found = recordingFetch(() => new Response(body));
		const missing = recordingFetch(() =>
			Response.json(unknown.body, { status: unknown.status }),
		);

		const read = await found.client.history("editor", CONVERSATION);

		expect(read?.body).toBe(body);
		expect(read?.history?.offset).toBe("0000000000000000_0000000000000016");
		expect(found.requests[0]).toMatchObject({
			url: `${CONVERSATION_URL}?view=history`,
			method: "GET",
		});
		expect(found.requests[0]?.headers.get("authorization")).toBe(
			`Bearer ${SECRET}`,
		);
		await expect(
			missing.client.history("editor", CONVERSATION),
		).resolves.toBeUndefined();
	});

	it("reads a window of history and returns the stream headers", async () => {
		const { requests, client } = recordingFetch(() =>
			Response.json(JSON.parse(fixture("flue-history.json")), {
				headers: { "stream-next-offset": "0_16", "stream-up-to-date": "true" },
			}),
		);

		const read = await client.history("editor", CONVERSATION, {
			limit: "20",
			from: "hc1.abc",
		});

		expect(requests[0]?.url).toBe(
			`${CONVERSATION_URL}?view=history&limit=20&from=hc1.abc`,
		);
		expect(read?.headers.get("stream-next-offset")).toBe("0_16");
		expect(read?.history?.offset).toBe("0000000000000000_0000000000000016");
	});

	it("reads a page of older messages without a snapshot", async () => {
		const page = { v: 1, conversationId: "conv_1", messages: [], before: null };
		const { requests, client } = recordingFetch(() => Response.json(page));

		const read = await client.history("editor", CONVERSATION, {
			before: "hc1.abc",
			limit: "5",
		});

		expect(requests[0]?.url).toBe(
			`${CONVERSATION_URL}?view=history&limit=5&before=hc1.abc`,
		);
		expect(read?.body).toBe(JSON.stringify(page));
		expect(read?.history).toBeUndefined();
	});

	it.each([null, "inst_1"])(
		"forwards uid %s and returns the echoed one",
		async (uid) => {
			const { requests, client } = recordingFetch(() =>
				Response.json(
					{ offset: "0_1", submissionId: "sub_1", uid: "inst_1" },
					{ status: 202 },
				),
			);

			await expect(
				client.send("editor", CONVERSATION, { message: MESSAGE, uid }),
			).resolves.toMatchObject({ uid: "inst_1" });
			expect(requests[0]?.body).toEqual({ ...MESSAGE, uid });
		},
	);

	it("carries the error type of a 404 without its body", async () => {
		const stale = JSON.parse(fixture("flue-send-stale-uid.json")) as {
			status: number;
			body: unknown;
		};
		const { client } = recordingFetch(() =>
			Response.json(stale.body, { status: stale.status }),
		);
		const error: unknown = await client
			.send("editor", CONVERSATION, { message: MESSAGE, uid: "inst_old" })
			.catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(SidecarError);
		expect(error).toMatchObject({
			status: 404,
			type: "agent_instance_not_found",
		});
		expect((error as SidecarError).message).toBe(
			"[payloadcms-flue] The sidecar answered 404.",
		);
	});

	it.each([
		[
			"one JSON page",
			{ offset: "0_3" },
			"view=updates&offset=0_3",
			"application/json",
		],
		[
			"a long poll",
			{ offset: "0_3", live: "long-poll", cursor: "c1" },
			"view=updates&offset=0_3&live=long-poll&cursor=c1",
			"application/json",
		],
		[
			"server-sent events",
			{ offset: "-1", live: "sse", from: "hc1.abc", limit: "20" },
			"view=updates&offset=-1&live=sse&from=hc1.abc&limit=20",
			"text/event-stream",
		],
	] as const)(
		"requests updates as %s",
		async (_label, read, search, accept) => {
			const { requests, client } = recordingFetch(() => new Response(""));

			await client.updates("editor", CONVERSATION, read);

			expect(requests[0]).toMatchObject({
				url: `${CONVERSATION_URL}?${search}`,
				method: "GET",
			});
			expect(requests[0]?.headers.get("accept")).toBe(accept);
			expect(requests[0]?.headers.get("authorization")).toBe(
				`Bearer ${SECRET}`,
			);
		},
	);

	it("aborts and reports whether a run was live", async () => {
		const { requests, client } = recordingFetch(() =>
			Response.json({ aborted: true }),
		);

		await expect(client.abort("editor", CONVERSATION)).resolves.toEqual({
			aborted: true,
		});
		expect(requests[0]).toMatchObject({
			url: `${CONVERSATION_URL}/abort`,
			method: "POST",
		});
		expect(requests[0]?.headers.get("authorization")).toBe(`Bearer ${SECRET}`);
	});

	it("turns a non-2xx answer into a SidecarError without its body", async () => {
		const { client } = recordingFetch(() =>
			Response.json(
				{ error: { message: `stream ${CONVERSATION}` } },
				{ status: 503 },
			),
		);
		const error: unknown = await client
			.send("editor", CONVERSATION, { message: MESSAGE })
			.catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(SidecarError);
		expect((error as SidecarError).status).toBe(503);
		expect((error as SidecarError).message).not.toContain(CONVERSATION);
	});

	it("gives up on a request the sidecar does not answer in time", async () => {
		const client = createSidecarClient({
			url: BASE,
			secret: SECRET,
			fetch: hangingFetch,
			timeoutMs: 5,
		});

		for (const call of [
			() => client.send("editor", CONVERSATION, { message: MESSAGE }),
			() => client.history("editor", CONVERSATION),
			() => client.updates("editor", CONVERSATION, { offset: "0_3" }),
			() => client.abort("editor", CONVERSATION),
		]) {
			// eslint-disable-next-line no-await-in-loop
			const error: unknown = await call().catch((caught: unknown) => caught);

			expect(error).toBeInstanceOf(SidecarError);
			expect((error as SidecarError).status).toBeUndefined();
			expect((error as SidecarError).message).toContain("in time");
		}
	});

	describe("updates deadline", () => {
		afterEach(() => {
			vi.useRealTimers();
		});

		it("gives a long poll 45 seconds to answer with its headers", async () => {
			vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

			const client = createSidecarClient({
				url: BASE,
				secret: SECRET,
				fetch: hangingFetch,
			});
			let settled = false;
			const read = client
				.updates("editor", CONVERSATION, { offset: "0_3", live: "long-poll" })
				.catch((caught: unknown) => caught)
				.finally(() => {
					settled = true;
				});

			await vi.advanceTimersByTimeAsync(44_999);

			expect(settled).toBe(false);

			await vi.advanceTimersByTimeAsync(1);

			const error = await read;

			expect(error).toBeInstanceOf(SidecarError);
			expect((error as SidecarError).message).toContain("in time");
		});

		it.each([undefined, "long-poll", "sse"] as const)(
			"lets the body outlast the deadline once the headers arrive (live %s)",
			async (live) => {
				let signal: AbortSignal | null | undefined;
				const client = createSidecarClient({
					url: BASE,
					secret: SECRET,
					timeoutMs: 5,
					fetch: (_input, init) => {
						signal = init?.signal;

						return Promise.resolve(new Response(""));
					},
				});

				await client.updates("editor", CONVERSATION, { offset: "0_3", live });
				await new Promise((resolve) => {
					setTimeout(resolve, 20);
				});

				expect(signal?.aborted).toBe(false);
			},
		);

		it("stops an updates read when the caller's signal aborts", async () => {
			const client = createSidecarClient({
				url: BASE,
				secret: SECRET,
				fetch: hangingFetch,
			});
			const controller = new AbortController();
			const read = client
				.updates("editor", CONVERSATION, {
					offset: "0_3",
					live: "long-poll",
					signal: controller.signal,
				})
				.catch((caught: unknown) => caught);

			controller.abort();

			const error = await read;

			expect(error).toBeInstanceOf(SidecarError);
			expect((error as SidecarError).message).not.toContain("in time");
		});
	});

	it("stops a history read when the caller's signal aborts", async () => {
		const client = createSidecarClient({
			url: BASE,
			secret: SECRET,
			fetch: hangingFetch,
		});
		const controller = new AbortController();
		const read = client
			.history("editor", CONVERSATION, { signal: controller.signal })
			.catch((caught: unknown) => caught);

		controller.abort();

		expect(await read).toBeInstanceOf(SidecarError);
	});

	it("turns a network failure into a SidecarError without a status", async () => {
		const client = createSidecarClient({
			url: BASE,
			secret: SECRET,
			fetch: () => Promise.reject(new TypeError("fetch failed")),
		});
		const error: unknown = await client
			.abort("editor", CONVERSATION)
			.catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(SidecarError);
		expect((error as SidecarError).status).toBeUndefined();
	});
});
