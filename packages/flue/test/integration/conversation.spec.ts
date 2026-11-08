import { randomUUID } from "node:crypto";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

import {
	bootPayload,
	enableEditorKey,
	keyEnabled,
	RECORDED_SUBMISSION,
	seed,
	send,
	shutdown,
	stored,
	THREADS_SLUG,
} from "./helpers/payload.js";
import {
	ATTACHMENT_BYTES,
	HISTORY_JSON,
	UPDATES_JSON,
	UPDATES_NEXT_OFFSET,
	UPDATES_SSE,
} from "./helpers/sidecar.js";
import { routePath } from "../../src/protocol/paths.js";
import { handleHash } from "../../src/threads/handle.js";

import type { Booted, Doc, Seeded, SeededUser } from "./helpers/payload.js";

const RUNNING_SUBMISSION = "sub_01M6VB1PKSNJ6YKC0R61XQDYSE";
// The title the recordings carry.
const RECORDED_TITLE = "Secret word lookup";
const HISTORY_OFFSET = "0000000000000000_0000000000000016";
const OFFSET = "0000000000000000_0000000000000003";
const EXPOSED =
	"Stream-Next-Offset, Stream-Up-To-Date, Stream-Cursor, Stream-Closed";

describe("the conversation endpoints", () => {
	let booted: Booted;
	let seeded: Seeded;

	// A running thread of the first user, as the plugin writes it.
	const runningThread = async (lastSubmissionId: string): Promise<Doc> =>
		await booted.payload.create({
			collection: THREADS_SLUG,
			data: {
				agent: "editor",
				kind: "chat",
				title: "Untitled",
				conversationId: randomUUID(),
				handleHash: handleHash(randomUUID()),
				createdBy: { relationTo: "users", value: seeded.first.id },
				status: "running",
				lastSubmissionId,
			},
			depth: 0,
			overrideAccess: true,
			showHiddenFields: true,
		});

	const read = (
		thread: Doc,
		query: string,
		user: SeededUser = seeded.first,
	): Promise<Response> =>
		send(booted, `/api/flue/c/${String(thread.id)}?${query}`, {
			token: user.token,
		});

	const requestsTo = (thread: Doc) =>
		booted.sidecar.requests.filter((request) =>
			request.path.includes(String(thread["conversationId"])),
		);

	const upstreamPaths = (thread: Doc) =>
		requestsTo(thread).map((request) => request.path);

	beforeAll(async () => {
		booted = await bootPayload("flue-conversation");
		seeded = await seed(booted.payload);
	});

	beforeEach(() => {
		booted.sidecar.reset();
	});

	afterAll(async () => {
		await shutdown(booted);
	});

	describe("conversationHandler view=history", () => {
		it("passes the history and its stream headers through and settles the thread it shows settled", async () => {
			const thread = await runningThread(RECORDED_SUBMISSION);
			const response = await read(thread, "view=history");

			expect(response.status).toBe(200);
			expect(Object.fromEntries(response.headers)).toMatchObject({
				"content-type": "application/json",
				"cache-control": "no-store",
				"stream-next-offset": HISTORY_OFFSET,
				"stream-up-to-date": "true",
				"access-control-expose-headers": EXPOSED,
				"x-content-type-options": "nosniff",
			});
			expect(await response.text()).toBe(HISTORY_JSON);
			expect(upstreamPaths(thread)).toEqual([
				`/agents/editor/${String(thread["conversationId"])}?view=history`,
			]);
			expect(await stored(booted, thread.id)).toMatchObject({
				status: "idle",
				title: RECORDED_TITLE,
			});
		});

		it("forwards the history window and nothing else", async () => {
			const thread = await runningThread(RECORDED_SUBMISSION);
			const response = await read(
				thread,
				"view=history&limit=20&from=hc1.abc&offset=-1&live=sse",
			);

			expect(response.status).toBe(200);
			expect(upstreamPaths(thread)).toEqual([
				`/agents/editor/${String(thread["conversationId"])}?view=history&limit=20&from=hc1.abc`,
			]);
		});

		it("forwards an opaque cursor as given", async () => {
			const thread = await runningThread(RECORDED_SUBMISSION);
			const response = await read(
				thread,
				"view=history&before=eyJhIjoxfQ%3D%3D.a%2Bb%2Fc~d",
			);

			expect(response.status).toBe(200);
			expect(upstreamPaths(thread)).toEqual([
				`/agents/editor/${String(thread["conversationId"])}?view=history&before=eyJhIjoxfQ%3D%3D.a%2Bb%2Fc%7Ed`,
			]);
		});

		it("keeps a title the user chose until the agent writes another", async () => {
			const thread = await runningThread(RECORDED_SUBMISSION);

			await (await read(thread, "view=history")).text();

			const renamed = await send(
				booted,
				`/api/${THREADS_SLUG}/${String(thread.id)}`,
				{ method: "PATCH", token: seeded.first.token, body: { title: "Mine" } },
			);

			expect(renamed.status).toBe(200);

			await (await read(thread, "view=history")).text();

			expect((await stored(booted, thread.id))["title"]).toBe("Mine");
		});

		it("leaves the title of an archived thread alone", async () => {
			const thread = await runningThread(RECORDED_SUBMISSION);
			const archived = await send(
				booted,
				`/api/${THREADS_SLUG}/${String(thread.id)}`,
				{
					method: "PATCH",
					token: seeded.first.token,
					body: { status: "archived" },
				},
			);

			expect(archived.status).toBe(200);
			expect((await read(thread, "view=history")).status).toBe(200);
			expect(await stored(booted, thread.id)).toMatchObject({
				status: "archived",
				title: "Untitled",
			});
			// The archive aborts without waiting; the abort lands before the next test.
			await vi.waitFor(() => {
				expect(upstreamPaths(thread)).toContain(
					`/agents/editor/${String(thread["conversationId"])}/abort`,
				);
			});
		});

		it("leaves the thread running while its submission is in flight", async () => {
			const thread = await runningThread(RUNNING_SUBMISSION);

			booted.sidecar.history = "running";

			expect((await read(thread, "view=history")).status).toBe(200);
			expect(await stored(booted, thread.id)).toMatchObject({
				status: "running",
				title: "Untitled",
			});
		});

		it("answers 404 for a conversation Flue has not seen, without naming it", async () => {
			const thread = await runningThread(RECORDED_SUBMISSION);

			booted.sidecar.history = "unknown";

			const response = await read(thread, "view=history");
			const text = await response.text();

			expect(response.status).toBe(404);
			expect(JSON.parse(text)).toEqual({ error: expect.any(String) });
			expect(text).not.toContain(String(thread["conversationId"]));
			expect((await stored(booted, thread.id))["status"]).toBe("running");
		});
	});

	describe("conversationHandler view=updates", () => {
		it.each([
			["a JSON page", "", UPDATES_JSON, "application/json"],
			["a long poll", "&live=long-poll", UPDATES_JSON, "application/json"],
			["server-sent events", "&live=sse", UPDATES_SSE, "text/event-stream"],
		])(
			"passes %s through and applies its title and settlement",
			async (_label, live, body, contentType) => {
				const thread = await runningThread(RECORDED_SUBMISSION);
				const response = await read(
					thread,
					`view=updates&offset=${OFFSET}${live}`,
				);

				expect(response.status).toBe(200);
				expect(Object.fromEntries(response.headers)).toMatchObject({
					"content-type": contentType,
					"cache-control": "no-store, no-transform",
					"access-control-expose-headers": EXPOSED,
					"x-content-type-options": "nosniff",
				});
				expect(await response.text()).toBe(body);
				expect(upstreamPaths(thread)).toEqual([
					`/agents/editor/${String(thread["conversationId"])}?view=updates&offset=${OFFSET}${live}`,
				]);
				expect(await stored(booted, thread.id)).toMatchObject({
					status: "idle",
					title: RECORDED_TITLE,
				});
			},
		);

		it("passes the stream headers of a page through", async () => {
			const thread = await runningThread(RECORDED_SUBMISSION);
			const response = await read(thread, `view=updates&offset=${OFFSET}`);

			await response.text();

			expect(response.headers.get("stream-next-offset")).toBe(
				UPDATES_NEXT_OFFSET,
			);
			expect(response.headers.get("stream-up-to-date")).toBe("true");
		});

		it("forwards the cursor and window and nothing else", async () => {
			const thread = await runningThread(RECORDED_SUBMISSION);
			const response = await read(
				thread,
				`view=updates&offset=-1&live=long-poll&cursor=c1&from=hc1.abc&limit=20&before=hc1.abc&tail=1`,
			);

			await response.text();

			expect(upstreamPaths(thread)).toEqual([
				`/agents/editor/${String(thread["conversationId"])}?view=updates&offset=-1&live=long-poll&cursor=c1&from=hc1.abc&limit=20`,
			]);
		});

		it("leaves the status alone when the settlement is for another submission", async () => {
			const thread = await runningThread("sub_other");
			const response = await read(
				thread,
				`view=updates&offset=${OFFSET}&live=sse`,
			);

			expect(await response.text()).toBe(UPDATES_SSE);
			expect(await stored(booted, thread.id)).toMatchObject({
				status: "running",
				title: RECORDED_TITLE,
			});
		});

		it("closes the sidecar connection when the reader cancels", async () => {
			const thread = await runningThread(RECORDED_SUBMISSION);

			booted.sidecar.hold = true;

			const response = await read(
				thread,
				`view=updates&offset=${OFFSET}&live=sse`,
			);
			const reader = response.body!.getReader();

			await reader.read();
			await reader.cancel();

			await vi.waitFor(() => {
				expect(booted.sidecar.dropped()).toEqual(
					expect.arrayContaining(requestsTo(thread)),
				);
			});
		});

		it("cancels a long poll upstream when the reader goes away before it answers", async () => {
			const thread = await runningThread(RECORDED_SUBMISSION);
			const controller = new AbortController();

			booted.sidecar.hold = true;

			const pending = send(
				booted,
				`/api/flue/c/${String(thread.id)}?view=updates&offset=${OFFSET}&live=long-poll`,
				{ token: seeded.first.token, signal: controller.signal },
			);

			await vi.waitFor(() => {
				expect(requestsTo(thread)).toHaveLength(1);
			});

			controller.abort();

			await vi.waitFor(() => {
				expect(booted.sidecar.dropped()).toEqual(
					expect.arrayContaining(requestsTo(thread)),
				);
			});
			await pending.catch(() => undefined);
			expect((await stored(booted, thread.id))["status"]).toBe("running");
		});

		it("passes an empty long-poll page through and leaves the row alone", async () => {
			const thread = await runningThread(RECORDED_SUBMISSION);

			booted.sidecar.updatesPage = "[]";

			const response = await read(
				thread,
				`view=updates&offset=${UPDATES_NEXT_OFFSET}&live=long-poll`,
			);

			expect(response.status).toBe(200);
			expect(await response.text()).toBe("[]");
			expect(response.headers.get("stream-next-offset")).toBe(
				UPDATES_NEXT_OFFSET,
			);
			expect(await stored(booted, thread.id)).toMatchObject({
				status: "running",
				title: "Untitled",
			});
		});

		it("reconciles the row with the snapshot of a reset", async () => {
			const thread = await runningThread(RECORDED_SUBMISSION);
			const snapshot = JSON.parse(HISTORY_JSON) as { conversationId: string };

			booted.sidecar.updatesPage = JSON.stringify([
				{
					type: "conversation-reset",
					conversationId: snapshot.conversationId,
					position: { batch: 0, index: 0 },
					snapshot,
				},
			]);

			const response = await read(thread, "view=updates&offset=-1");

			await response.text();

			expect(await stored(booted, thread.id)).toMatchObject({
				status: "idle",
				title: RECORDED_TITLE,
			});
		});

		it.each([400, 404, 410, 416])(
			"answers the sidecar's %i with a body of its own",
			async (status) => {
				const thread = await runningThread(RECORDED_SUBMISSION);

				booted.sidecar.updatesStatus = status;

				const response = await read(thread, `view=updates&offset=${OFFSET}`);
				const text = await response.text();

				expect(response.status).toBe(status);
				expect(JSON.parse(text)).toEqual({ error: expect.any(String) });
				expect(text).not.toContain(String(thread["conversationId"]));
				expect((await stored(booted, thread.id))["status"]).toBe("running");
			},
		);

		it.each([
			["a malformed offset", "offset=a%20b"],
			["no offset", "live=sse"],
			["an unknown live mode", `offset=${OFFSET}&live=poll`],
			["a malformed limit", `offset=${OFFSET}&limit=0`],
			["a cursor outside the opaque characters", `offset=${OFFSET}&from=a%3Cb`],
			["a cursor with a colon", `offset=${OFFSET}&cursor=a:b`],
		])("refuses %s without asking the sidecar", async (_label, query) => {
			const thread = await runningThread(RECORDED_SUBMISSION);
			const response = await read(thread, `view=updates&${query}`);

			expect(response.status).toBe(400);
			expect(await response.json()).toEqual({ error: expect.any(String) });
			expect(requestsTo(thread)).toEqual([]);
		});

		it("answers 502 without naming the conversation when the sidecar refuses", async () => {
			const thread = await runningThread(RECORDED_SUBMISSION);

			booted.sidecar.refuse = true;

			const response = await read(thread, `view=updates&offset=${OFFSET}`);
			const text = await response.text();

			expect(response.status).toBe(502);
			expect(text).not.toContain(String(thread["conversationId"]));
			expect((await stored(booted, thread.id))["status"]).toBe("running");
		});
	});

	describe("conversationHandler", () => {
		it.each([
			["view=history", "/api/flue/c/abc?view=history"],
			["abort", "/api/flue/c/1%3B/abort"],
		])(
			"answers 404 for a thread id of another form without a lookup (%s)",
			async (_label, path) => {
				const requests = booted.sidecar.requests.length;
				const response = await send(booted, path, {
					method: path.endsWith("/abort") ? "POST" : "GET",
					token: seeded.first.token,
					...(path.endsWith("/abort") ? { body: "{}" } : {}),
				});

				expect(response.status).toBe(404);
				expect(await response.json()).toEqual({ error: expect.any(String) });
				expect(booted.sidecar.requests).toHaveLength(requests);
			},
		);

		it.each([
			"view=history",
			`view=updates&offset=${OFFSET}`,
			`view=updates&offset=${OFFSET}&live=long-poll`,
			`view=updates&offset=${OFFSET}&live=sse`,
		])(
			"refuses another user's thread with 404 and no upstream request (%s)",
			async (query) => {
				const thread = await runningThread(RECORDED_SUBMISSION);
				const response = await read(thread, query, seeded.second);

				expect(response.status).toBe(404);
				expect(await response.json()).toEqual({ error: expect.any(String) });
				expect(requestsTo(thread)).toEqual([]);
				expect((await stored(booted, thread.id))["status"]).toBe("running");
			},
		);
	});

	describe("conversationAttachmentHandler", () => {
		const IMAGE = "att_image_sub_01M6VB02GCSHGD7X1Z5829HF5Q_0";
		const DOCUMENT = "att_document_sub_01M6VB02GCSHGD7X1Z5829HF5Q_1";

		// The path the Flue client resolves a `file` part's url to.
		const attachmentPath = (thread: Doc, attachment: string): string =>
			`/api/flue${routePath("conversation", { thread: thread.id })}/attachments/${attachment}`;

		const fetchAttachment = (
			thread: Doc,
			attachment: string,
			user: null | SeededUser = seeded.first,
		): Promise<Response> =>
			send(booted, attachmentPath(thread, attachment), {
				...(user === null ? {} : { token: user.token }),
			});

		it("passes an image and Flue's headers through to the owner", async () => {
			const thread = await runningThread(RECORDED_SUBMISSION);
			const response = await fetchAttachment(thread, IMAGE);

			expect(response.status).toBe(200);
			expect(Buffer.from(await response.arrayBuffer())).toEqual(
				ATTACHMENT_BYTES.image,
			);
			expect(Object.fromEntries(response.headers)).toMatchObject({
				"content-type": "image/png",
				"content-length": String(ATTACHMENT_BYTES.image.byteLength),
				"content-disposition": "inline",
				"cache-control": "private, max-age=31536000, immutable",
				"content-security-policy": "sandbox",
				"x-content-type-options": "nosniff",
			});
			expect(upstreamPaths(thread)).toEqual([
				`/agents/editor/${String(thread["conversationId"])}/attachments/${IMAGE}`,
			]);
		});

		it("serves a PDF as a download", async () => {
			const thread = await runningThread(RECORDED_SUBMISSION);
			const response = await fetchAttachment(thread, DOCUMENT);

			expect(response.status).toBe(200);
			expect(Buffer.from(await response.arrayBuffer())).toEqual(
				ATTACHMENT_BYTES.document,
			);
			expect(Object.fromEntries(response.headers)).toMatchObject({
				"content-type": "application/pdf",
				"content-disposition": "attachment",
				"cache-control": "private, max-age=31536000, immutable",
				"content-security-policy": "sandbox",
				"x-content-type-options": "nosniff",
			});
		});

		it("serves an SVG as a sandboxed download", async () => {
			const thread = await runningThread(RECORDED_SUBMISSION);
			const response = await fetchAttachment(
				thread,
				"att_svg_sub_01M6VB02GCSHGD7X1Z5829HF5Q_2",
			);

			expect(response.status).toBe(200);
			expect(Object.fromEntries(response.headers)).toMatchObject({
				"content-type": "image/svg+xml",
				"content-disposition": "attachment",
				"content-security-policy": "sandbox",
			});
		});

		it("refuses another user's thread with 404 and forwards nothing", async () => {
			const thread = await runningThread(RECORDED_SUBMISSION);
			const response = await fetchAttachment(thread, IMAGE, seeded.second);

			expect(response.status).toBe(404);
			expect(await response.json()).toEqual({ error: expect.any(String) });
			expect(requestsTo(thread)).toEqual([]);
		});

		it("refuses a request without a session with 401 and forwards nothing", async () => {
			const thread = await runningThread(RECORDED_SUBMISSION);
			const response = await fetchAttachment(thread, IMAGE, null);

			expect(response.status).toBe(401);
			expect(await response.json()).toEqual({ error: expect.any(String) });
			expect(requestsTo(thread)).toEqual([]);
		});

		it("answers 404 for an attachment Flue does not have", async () => {
			const thread = await runningThread(RECORDED_SUBMISSION);
			const response = await fetchAttachment(thread, "att_unknown_1");

			expect(response.status).toBe(404);
			expect(await response.json()).toEqual({ error: expect.any(String) });
		});

		it.each(["nope", "att_", "att_a.b", `att_${"a".repeat(201)}`])(
			"refuses the malformed id %j with 400 and forwards nothing",
			async (attachment) => {
				const thread = await runningThread(RECORDED_SUBMISSION);
				const response = await fetchAttachment(thread, attachment);

				expect(response.status).toBe(400);
				expect(await response.json()).toEqual({ error: expect.any(String) });
				expect(requestsTo(thread)).toEqual([]);
			},
		);

		it("answers 502 without naming the conversation when the sidecar refuses", async () => {
			const thread = await runningThread(RECORDED_SUBMISSION);

			booted.sidecar.refuse = true;

			const response = await fetchAttachment(thread, IMAGE);
			const text = await response.text();

			expect(response.status).toBe(502);
			expect(text).not.toContain(String(thread["conversationId"]));
		});
	});

	describe("abortHandler", () => {
		// A running thread of the first user and the key its turn enabled.
		const startRun = async (): Promise<{
			thread: Doc;
			apiKeyId: number | string;
		}> => ({
			apiKeyId: await enableEditorKey(booted, seeded.first.id),
			thread: await runningThread(RUNNING_SUBMISSION),
		});

		const abort = (
			user: SeededUser,
			thread: Doc,
			headers?: Record<string, string>,
		) =>
			send(booted, `/api/flue/c/${String(thread.id)}/abort`, {
				method: "POST",
				token: user.token,
				body: "{}",
				...(headers ? { headers } : {}),
			});

		const abortsOf = (thread: Doc) =>
			booted.sidecar
				.aborts()
				.filter((request) =>
					request.path.includes(String(thread["conversationId"])),
				);

		it("stops the owner's run, disables the key and idles the thread", async () => {
			const { thread, apiKeyId } = await startRun();

			expect(await keyEnabled(booted, apiKeyId)).toBe(true);

			const response = await abort(seeded.first, thread);

			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ aborted: true });
			expect(abortsOf(thread)).toHaveLength(1);
			expect(await keyEnabled(booted, apiKeyId)).toBe(false);
			expect((await stored(booted, thread.id))["status"]).toBe("idle");
		});

		it("answers aborted false when Flue has not seen the conversation", async () => {
			const { thread, apiKeyId } = await startRun();

			booted.sidecar.abortStatus = 404;

			const response = await abort(seeded.first, thread);

			expect(response.status).toBe(200);
			expect(await response.json()).toEqual({ aborted: false });
			expect(await keyEnabled(booted, apiKeyId)).toBe(false);
			expect((await stored(booted, thread.id))["status"]).toBe("running");
		});

		it("refuses another user and forwards nothing", async () => {
			const { thread, apiKeyId } = await startRun();

			const response = await abort(seeded.second, thread);

			expect(response.status).toBe(404);
			expect(await response.json()).toEqual({ error: expect.any(String) });
			expect(abortsOf(thread)).toEqual([]);
			expect(await keyEnabled(booted, apiKeyId)).toBe(true);
			expect((await stored(booted, thread.id))["status"]).toBe("running");
		});

		it("refuses a request without the JSON content type", async () => {
			const { thread, apiKeyId } = await startRun();

			const response = await abort(seeded.first, thread, {
				"content-type": "text/plain",
			});

			expect(response.status).toBe(415);
			expect(abortsOf(thread)).toEqual([]);
			expect(await keyEnabled(booted, apiKeyId)).toBe(true);
			expect((await stored(booted, thread.id))["status"]).toBe("running");
		});
	});
});
