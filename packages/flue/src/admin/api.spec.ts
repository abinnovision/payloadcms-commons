import { afterEach, describe, expect, it, vi } from "vitest";

import { errorText, flueApi } from "./api.js";

const api = flueApi({
	serverURL: "https://cms.example.com",
	apiRoute: "/api",
	endpointPath: "/flue",
	threadsSlug: "flue-threads",
	mcpxEndpointPath: "/mcpx",
});

interface Sent {
	url: string;
	method: string;
	contentType: null | string;
	body: unknown;
}

// Answers every request with `response` and records what was sent.
const answer = (response: () => Response): Sent[] => {
	const sent: Sent[] = [];

	vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
		const headers = new Headers(init?.headers);

		sent.push({
			url,
			method: init?.method ?? "GET",
			contentType: headers.get("content-type"),
			body:
				typeof init?.body === "string"
					? (JSON.parse(init.body) as unknown)
					: undefined,
		});

		return Promise.resolve(response());
	});

	return sent;
};

// The query of a URL, decoded and in order.
const query = (url: string): [string, string][] => [
	...new URL(url).searchParams.entries(),
];

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("flueApi", () => {
	it("rejects with the message of a refusal", async () => {
		answer(() => Response.json({ error: "No such agent." }, { status: 404 }));

		await expect(api.agents()).rejects.toThrow("No such agent.");
	});

	it("rejects with a generic message when the refusal's error is not a string", async () => {
		answer(() =>
			Response.json({ error: { type: "stream_not_found" } }, { status: 404 }),
		);

		await expect(api.thread(7)).rejects.toThrow(
			"The request failed with status 404.",
		);
	});

	it("addresses a thread's conversation below the plugin's endpoint", () => {
		expect(api.conversationUrl(7)).toBe("https://cms.example.com/api/flue/c/7");
	});

	it("aborts a run with a JSON body and accepts an empty answer", async () => {
		const sent = answer(() => new Response(null, { status: 204 }));

		await expect(api.abort(7)).resolves.toBeUndefined();
		expect(sent).toEqual([
			{
				url: "https://cms.example.com/api/flue/c/7/abort",
				method: "POST",
				contentType: "application/json",
				body: {},
			},
		]);
	});

	it("pages the agent's chats by message time, newest first", async () => {
		const sent = answer(() =>
			Response.json({ docs: [], hasNextPage: true, totalDocs: 9 }),
		);

		await expect(
			api.threads(
				{ kind: "chat", agent: "editor" },
				{
					limit: 50,
					after: { lastMessageAt: "2026-11-08T10:42:00.000Z", id: 41 },
				},
			),
		).resolves.toEqual({ docs: [], hasNextPage: true });
		expect(query(sent[0]!.url)).toEqual([
			["sort", "-lastMessageAt,-id"],
			["limit", "50"],
			["depth", "0"],
			["where[and][0][status][not_equals]", "archived"],
			["where[and][1][kind][equals]", "chat"],
			["where[and][2][agent][equals]", "editor"],
			["where[and][3][lastMessageAt][exists]", "true"],
			[
				"where[and][4][or][0][lastMessageAt][less_than]",
				"2026-11-08T10:42:00.000Z",
			],
			[
				"where[and][4][or][1][and][0][lastMessageAt][equals]",
				"2026-11-08T10:42:00.000Z",
			],
			["where[and][4][or][1][and][1][id][less_than]", "41"],
		]);
	});

	it("searches the titles of the user's chats across agents", async () => {
		const sent = answer(() => Response.json({ docs: [], hasNextPage: false }));

		await api.threads(
			{ kind: "chat", agent: ["editor", "summarizer"], title: "pricing" },
			{ limit: 20 },
		);

		expect(query(sent[0]!.url)).toEqual([
			["sort", "-lastMessageAt,-id"],
			["limit", "20"],
			["depth", "0"],
			["where[and][0][status][not_equals]", "archived"],
			["where[and][1][kind][equals]", "chat"],
			["where[and][2][agent][in]", "editor,summarizer"],
			["where[and][3][title][like]", "pricing"],
			["where[and][4][lastMessageAt][exists]", "true"],
		]);
	});

	it("pages the agent runs of every agent, or of one", async () => {
		const sent = answer(() => Response.json({ docs: [], hasNextPage: false }));

		await api.threads({ kind: "run" }, { limit: 50 });
		await api.threads(
			{ kind: "run", agent: "editor", title: "link" },
			{ limit: 20 },
		);

		expect(query(sent[0]!.url).slice(3)).toEqual([
			["where[and][0][status][not_equals]", "archived"],
			["where[and][1][kind][in]", "reactive,ambient"],
			["where[and][2][lastMessageAt][exists]", "true"],
		]);
		expect(query(sent[1]!.url).slice(3)).toEqual([
			["where[and][0][status][not_equals]", "archived"],
			["where[and][1][kind][in]", "reactive,ambient"],
			["where[and][2][agent][equals]", "editor"],
			["where[and][3][title][like]", "link"],
			["where[and][4][lastMessageAt][exists]", "true"],
		]);
	});

	it("reads the agents and whether the user may read their runs", async () => {
		answer(() =>
			Response.json({
				agents: [{ slug: "editor" }],
				runs: { agents: [{ slug: "editor" }, { slug: "auditor" }] },
			}),
		);

		await expect(api.agents()).resolves.toEqual({
			agents: [{ slug: "editor" }],
			runs: { agents: [{ slug: "editor" }, { slug: "auditor" }] },
		});
	});

	it("deletes an uploaded file through the collection's REST API", async () => {
		const sent = answer(() => Response.json({ doc: { id: 12 } }));

		await api.deleteFile("uploads", "12");

		expect(sent).toMatchObject([
			{ url: "https://cms.example.com/api/uploads/12", method: "DELETE" },
		]);
	});

	describe("fileLink", () => {
		it("points at Payload's file route, never the document's url", async () => {
			const sent = answer(() =>
				Response.json({
					id: 12,
					filename: "a b.md",
					url: "https://cdn.example.com/public/a b.md",
				}),
			);

			await expect(api.fileLink("uploads", "12")).resolves.toBe(
				"https://cms.example.com/api/uploads/file/a%20b.md",
			);
			expect(sent[0]!.url).toBe(
				"https://cms.example.com/api/uploads/12?depth=0",
			);
		});

		it("carries the storage prefix of the document", async () => {
			answer(() => Response.json({ filename: "a.md", prefix: "chat/7" }));

			await expect(api.fileLink("uploads", "12")).resolves.toBe(
				"https://cms.example.com/api/uploads/file/a.md?prefix=chat%2F7",
			);
		});

		it("answers null for a file that is gone or out of reach", async () => {
			answer(() => Response.json({ errors: [] }, { status: 404 }));
			await expect(api.fileLink("uploads", "12")).resolves.toBeNull();

			answer(() => Response.json({ errors: [] }, { status: 403 }));
			await expect(api.fileLink("uploads", "12")).resolves.toBeNull();
		});

		it("rejects on any other failure", async () => {
			answer(() => Response.json({ errors: [] }, { status: 500 }));

			await expect(api.fileLink("uploads", "12")).rejects.toThrow(
				"The request failed with status 500.",
			);
		});
	});

	describe("uploadFile", () => {
		interface Request {
			method: string;
			url: string;
			credentials: boolean;
			form: FormData | undefined;
		}

		interface FakeXhr {
			status: number;
			responseText: string;
			withCredentials: boolean;
			upload: {
				onprogress?: (event: {
					loaded: number;
					total: number;
					lengthComputable: boolean;
				}) => void;
			};
			onload: () => void;
			onerror: () => void;
			open: (method: string, url: string) => void;
			send: (form: FormData) => void;
		}

		// A stand-in for the browser's XHR that answers as `reply` tells it.
		const xhr = (reply: (self: FakeXhr) => void): { requests: Request[] } => {
			const requests: Request[] = [];

			vi.stubGlobal("XMLHttpRequest", function Fake() {
				let method = "";
				let url = "";
				const self: FakeXhr = {
					status: 0,
					responseText: "",
					withCredentials: false,
					upload: {},
					onload: () => undefined,
					onerror: () => undefined,
					open: (verb, target) => {
						method = verb;
						url = target;
					},
					send: (form) => {
						requests.push({
							method,
							url,
							credentials: self.withCredentials,
							form,
						});
						reply(self);
					},
				};

				return self;
			});

			return { requests };
		};

		const file = new File(["# Notes"], "notes.md", { type: "text/markdown" });

		it("posts the file as multipart and resolves to the id", async () => {
			const { requests } = xhr((self) => {
				self.status = 201;
				self.responseText = JSON.stringify({ doc: { id: 12 } });
				self.onload();
			});

			await expect(
				api.uploadFile("uploads", file, () => undefined),
			).resolves.toBe("12");

			expect(requests).toHaveLength(1);
			expect(requests[0]).toMatchObject({
				method: "POST",
				url: "https://cms.example.com/api/uploads",
				credentials: true,
			});
			expect((requests[0]!.form!.get("file") as File).name).toBe("notes.md");
			expect(requests[0]!.form!.get("_payload")).toBeNull();
		});

		it("reports the share uploaded as the browser sends it", async () => {
			const seen: number[] = [];

			xhr((self) => {
				self.upload.onprogress?.({
					loaded: 25,
					total: 100,
					lengthComputable: true,
				});
				self.upload.onprogress?.({
					loaded: 100,
					total: 100,
					lengthComputable: false,
				});
				self.status = 201;
				self.responseText = JSON.stringify({ doc: { id: 1 } });
				self.onload();
			});

			await api.uploadFile("uploads", file, (fraction) => {
				seen.push(fraction);
			});

			expect(seen).toEqual([0.25]);
		});

		it.each([
			[
				"names a 413 as the server taking no file this large",
				413,
				"<html>Request Entity Too Large</html>",
				"notes.md is larger than the server takes.",
			],
			[
				"rejects with Payload's message for another refusal",
				400,
				JSON.stringify({
					errors: [{ message: "The file type must be one of text/plain." }],
				}),
				"The file type must be one of text/plain.",
			],
			[
				"rejects with the status when the answer has no message",
				502,
				"bad gateway",
				"notes.md could not be uploaded (status 502).",
			],
		])("%s", async (_label, status, responseText, message) => {
			xhr((self) => {
				self.status = status;
				self.responseText = responseText;
				self.onload();
			});

			await expect(
				api.uploadFile("uploads", file, () => undefined),
			).rejects.toThrow(message);
		});
	});

	it("reads the status and message time of the polled threads only", async () => {
		const states = [
			{ id: 3, status: "idle", lastMessageAt: "2026-11-08T10:42:00.000Z" },
		];
		const sent = answer(() => Response.json({ docs: states }));

		await expect(api.threadStates([3, "7"])).resolves.toEqual(states);
		expect(query(sent[0]!.url)).toEqual([
			["select[status]", "true"],
			["select[lastMessageAt]", "true"],
			["limit", "2"],
			["depth", "0"],
			["where[id][in]", "3,7"],
		]);
	});

	it("reconciles a thread through the newest entry of its history", async () => {
		const sent = answer(() => Response.json({ messages: [], settlements: [] }));

		await expect(api.reconcile(7)).resolves.toBeUndefined();
		expect(sent.map(({ url, method }) => ({ url, method }))).toEqual([
			{
				url: "https://cms.example.com/api/flue/c/7?view=history&limit=1",
				method: "GET",
			},
		]);
	});

	it("reads the handle of a pending call from mcpx", async () => {
		const sent = answer(() =>
			Response.json({
				confirmations: [
					{ handle: "h-other", highlighted: false },
					{ handle: "h-1", highlighted: true },
				],
			}),
		);

		await expect(api.confirmationHandle("flue-thread:7", "c-1")).resolves.toBe(
			"h-1",
		);
		expect(sent.map(({ url, method }) => ({ url, method }))).toEqual([
			{
				url: "https://cms.example.com/api/mcpx/confirmations?principal=flue-thread%3A7&confirmation=c-1",
				method: "GET",
			},
		]);
	});

	it("finds no handle once the call no longer waits", async () => {
		answer(() => Response.json({ confirmations: [] }));

		await expect(
			api.confirmationHandle("flue-thread:7", "c-1"),
		).resolves.toBeUndefined();
	});

	it("posts a decision to mcpx and reports whether it was recorded", async () => {
		const sent = answer(() => Response.json({ decided: ["h-1"] }));

		await expect(api.decide("flue-thread:7", "h-1", "approved")).resolves.toBe(
			true,
		);
		expect(sent).toEqual([
			{
				url: "https://cms.example.com/api/mcpx/confirmations",
				method: "POST",
				contentType: "application/json",
				body: {
					principal: "flue-thread:7",
					handles: ["h-1"],
					decision: "approved",
				},
			},
		]);
	});

	it("reports a decision on a call that was decided elsewhere as not recorded", async () => {
		answer(() => Response.json({ decided: [] }));

		await expect(api.decide("flue-thread:7", "h-1", "rejected")).resolves.toBe(
			false,
		);
	});
});

describe("errorText", () => {
	const FALLBACK = "The conversation could not be loaded.";

	// The shapes `@flue/sdk` and `@durable-streams/client` throw, by the field holding the body.
	const failed = (name: string, field: string, body: unknown): Error =>
		Object.assign(
			new Error(`HTTP Error 404 at https://cms.example.com/api/flue/c/7`),
			{
				name,
				status: 404,
				[field]: body,
			},
		);

	it.each([
		["FlueApiError", "body"],
		["FetchError", "json"],
		["DurableStreamError", "details"],
	])("shows the plugin's refusal a %s carries", (name, field) => {
		expect(
			errorText(
				failed(name, field, { error: "The thread does not exist." }),
				FALLBACK,
			),
		).toBe("The thread does not exist.");
	});

	it("hides the message of an SDK error without the plugin's refusal", () => {
		expect(
			errorText(
				failed("FetchError", "json", { error: { type: "stream_not_found" } }),
				FALLBACK,
			),
		).toBe(FALLBACK);
		expect(errorText(new TypeError("Failed to fetch"), FALLBACK)).toBe(
			FALLBACK,
		);
		expect(errorText("broken", FALLBACK)).toBe(FALLBACK);
	});

	it("shows the message of a refused plugin call", async () => {
		answer(() => Response.json({ error: "No such agent." }, { status: 404 }));

		const error: unknown = await api
			.agents()
			.catch((caught: unknown) => caught);

		expect(errorText(error, FALLBACK)).toBe("No such agent.");
	});
});
