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
	API_KEYS_SLUG,
	bootPayload,
	count,
	exchange,
	seed,
	send,
	shutdown,
	stored,
	THREADS_SLUG,
} from "./helpers/payload.js";
import {
	CONTEXT_SIGNAL_TYPE,
	userTurnBody,
} from "../../src/protocol/context.js";
import { INITIAL_DATA_KEY } from "../../src/protocol/exchange.js";
import { handleHash } from "../../src/threads/handle.js";
import { SIDECAR_SECRET } from "../fixtures/config.js";

import type { Booted, Doc, Seeded, SeededUser } from "./helpers/payload.js";
import type { RecordedRequest } from "./helpers/sidecar.js";
import type { SendArgs } from "../../src/sidecar/client.js";

// The arguments of every sidecar send, to read the deadline a turn gets.
const sends = vi.hoisted((): SendArgs[] => []);

vi.mock(import("../../src/sidecar/client.js"), async (importOriginal) => {
	const actual = await importOriginal();

	return {
		...actual,
		createSidecarClient: (
			...args: Parameters<typeof actual.createSidecarClient>
		) => {
			const client = actual.createSidecarClient(...args);

			return {
				...client,
				send: (...sendArgs: Parameters<typeof client.send>) => {
					sends.push(sendArgs[2]);

					return client.send(...sendArgs);
				},
			};
		},
	};
});

interface ChatResult {
	thread: { id: number | string; title: string; status: string };
	offset: string;
	submissionId: string;
	streamUrl: string;
}

interface Posted {
	kind: string;
	type: string;
	body: string;
	attributes: Record<string, string>;
	attachments?: unknown[];
	uid?: null | string;
	initialData?: Record<string, { handle: string }>;
}

const CONTEXT = { route: "/admin" };

const KIB = 1024;
const MIB = 1024 * KIB;

const PNG_SIGNATURE = "\x89PNG\r\n\x1a\n";
const PDF_SIGNATURE = "%PDF-1.7\n";

// Base64 of `bytes` bytes that start with `signature`, zeros after it.
const base64Of = (bytes: number, signature = PNG_SIGNATURE): string => {
	const buffer = Buffer.alloc(bytes);

	buffer.write(signature, "latin1");

	return buffer.toString("base64");
};

const PNG = {
	type: "image",
	mimeType: "image/png",
	data: base64Of(16),
	filename: "diagram.png",
};

describe("the chat endpoints", () => {
	let booted: Booted;
	let seeded: Seeded;

	const chat = (
		user: SeededUser | undefined,
		body: unknown,
		args: { agent?: string; headers?: Record<string, string> } = {},
	) =>
		send(booted, `/api/flue/chat/${args.agent ?? "editor"}`, {
			method: "POST",
			body,
			...(user ? { token: user.token } : {}),
			...(args.headers ? { headers: args.headers } : {}),
		});

	const chatOk = async (
		user: SeededUser,
		body: Record<string, unknown>,
	): Promise<ChatResult> => {
		const response = await chat(user, { context: CONTEXT, ...body });

		expect(response.status).toBe(200);

		return (await response.json()) as ChatResult;
	};

	// A thread as the plugin writes it, which recorded no incarnation in Flue.
	const unsentThread = async (user: SeededUser): Promise<Doc> =>
		await booted.payload.create({
			collection: THREADS_SLUG,
			data: {
				agent: "editor",
				kind: "chat",
				conversationId: randomUUID(),
				handleHash: handleHash(randomUUID()),
				createdBy: { relationTo: "users", value: user.id },
			},
			depth: 0,
			overrideAccess: true,
			showHiddenFields: true,
		});

	const requestsTo = (conversationId: unknown): RecordedRequest[] =>
		booted.sidecar.requests.filter((request) =>
			request.path.startsWith(`/agents/editor/${String(conversationId)}`),
		);

	const postsTo = (conversationId: unknown): Posted[] =>
		requestsTo(conversationId)
			.filter((request) => request.method === "POST")
			.map((request) => JSON.parse(request.body) as Posted);

	const handleOf = (posted: Posted | undefined): string | undefined =>
		posted?.initialData?.[INITIAL_DATA_KEY]?.handle;

	// The thread of a conversation, read past access control.
	const rowOf = async (conversationId: unknown): Promise<Doc> => {
		const { docs } = await booted.payload.find({
			collection: THREADS_SLUG,
			where: { conversationId: { equals: conversationId } },
			depth: 0,
			overrideAccess: true,
			showHiddenFields: true,
		});

		expect(docs).toHaveLength(1);

		return docs[0]!;
	};

	beforeAll(async () => {
		booted = await bootPayload("flue-chat");
		seeded = await seed(booted.payload);
	});

	beforeEach(() => {
		booted.sidecar.reset();
	});

	afterAll(async () => {
		await shutdown(booted);
	});

	describe("chatHandler", () => {
		it("creates the user's thread and sends the handle with the first turn", async () => {
			const page = await booted.payload.create({
				collection: "pages",
				data: { title: "About" },
				overrideAccess: true,
			});
			const read = await booted.payload.findByID({
				collection: "pages",
				id: page.id,
				draft: true,
				overrideAccess: true,
			});
			const context = {
				route: `/admin/collections/pages/${String(page.id)}`,
				collection: "pages",
				id: page.id,
			};

			const response = await chat(
				seeded.first,
				{ message: "What is this page about?", context },
				{ headers: { cookie: `payload-token=${seeded.first.token}` } },
			);
			const result = (await response.json()) as ChatResult;
			const row = await stored(booted, result.thread.id);
			const requests = requestsTo(row["conversationId"]);
			const [posted] = postsTo(row["conversationId"]);
			const handle = handleOf(posted);

			expect(response.status).toBe(200);
			expect(result).toEqual({
				thread: {
					id: row.id,
					title: "What is this page about?",
					status: "running",
				},
				offset: "0000000000000000_0000000000000000",
				submissionId: row["lastSubmissionId"],
				streamUrl: `/api/flue/c/${String(row.id)}`,
			});
			expect(row).toMatchObject({
				agent: "editor",
				kind: "chat",
				createdBy: { relationTo: "users", value: seeded.first.id },
				context: { collection: "pages", docId: String(page.id) },
				lastSubmissionId: expect.stringMatching(/^sub_/) as unknown,
			});
			expect(requests).toHaveLength(1);
			expect(requests[0]?.headers.cookie).toBeUndefined();
			expect(requests[0]?.headers.authorization).toBe(
				`Bearer ${SIDECAR_SECRET}`,
			);
			expect(handle).toEqual(expect.any(String));
			expect(handle).not.toBe(row["conversationId"]);
			expect(handleHash(handle ?? "")).toBe(row["handleHash"]);
			expect(JSON.stringify(row)).not.toContain(handle);
			expect(posted).toMatchObject({
				kind: "signal",
				type: CONTEXT_SIGNAL_TYPE,
				body: "What is this page about?",
				attributes: {
					turn: "user",
					kind: "chat",
					route: context.route,
					collection: "pages",
					id: String(page.id),
					updatedAt: read["updatedAt"],
				},
			});
		});

		it("reuses the thread for the next message without initialData", async () => {
			const first = await chatOk(seeded.first, { message: "One" });
			const before = await stored(booted, first.thread.id);
			const second = await chatOk(seeded.first, {
				message: "Two",
				thread: first.thread.id,
			});
			const after = await stored(booted, first.thread.id);
			const posts = postsTo(before["conversationId"]);

			expect(second.thread.id).toBe(first.thread.id);
			expect(
				requestsTo(before["conversationId"]).map((request) => request.method),
			).toEqual(["POST", "POST"]);
			expect(posts).toHaveLength(2);
			expect(posts[1]).not.toHaveProperty("initialData");
			expect(posts[1]?.uid).toBe(before["flueUid"]);
			expect(posts[1]?.body).toBe("Two");
			expect(after["handleHash"]).toBe(before["handleHash"]);
			expect(after["lastSubmissionId"]).not.toBe(before["lastSubmissionId"]);
		});

		it("a turn writes nothing to payload-kv", async () => {
			const before = await count(booted, "payload-kv");
			const first = await chatOk(seeded.first, { message: "One" });

			await chatOk(seeded.first, { message: "Two", thread: first.thread.id });

			expect(await count(booted, "payload-kv")).toBe(before);
		});

		it("keeps a thread archived while its message goes out and refuses with 409", async () => {
			const { thread } = await chatOk(seeded.first, { message: "First" });
			const before = await stored(booted, thread.id);
			const gate = Promise.withResolvers<undefined>();

			booted.sidecar.sendGate = gate.promise;

			const pending = chat(seeded.first, {
				message: "Second",
				thread: thread.id,
				context: CONTEXT,
			});

			await vi.waitFor(() => {
				expect(postsTo(before["conversationId"])).toHaveLength(2);
			});

			const archived = await send(
				booted,
				`/api/${THREADS_SLUG}/${String(thread.id)}`,
				{
					method: "PATCH",
					token: seeded.first.token,
					body: { status: "archived" },
				},
			);

			gate.resolve(undefined);

			const response = await pending;

			expect(archived.status).toBe(200);
			expect(response.status).toBe(409);
			expect(await response.json()).toEqual({ error: expect.any(String) });
			expect(await stored(booted, thread.id)).toMatchObject({
				status: "archived",
				lastSubmissionId: before["lastSubmissionId"],
			});
			expect(
				(
					await exchange(booted, {
						handle: handleOf(postsTo(before["conversationId"])[0]),
						agent: "editor",
					})
				).status,
			).toBe(404);
			// The archive aborts without waiting; the abort lands before the next test.
			await vi.waitFor(() => {
				expect(
					requestsTo(before["conversationId"]).map((request) => request.path),
				).toContain(`/agents/editor/${String(before["conversationId"])}/abort`);
			});
		});

		it("sends the first message create-only with initialData and stores the incarnation uid and lastMessageAt", async () => {
			const gate = Promise.withResolvers<undefined>();
			const sends = booted.sidecar.sends().length;

			booted.sidecar.sendGate = gate.promise;

			const pending = chat(seeded.first, { message: "New", context: CONTEXT });

			await vi.waitFor(() => {
				expect(booted.sidecar.sends()).toHaveLength(sends + 1);
			});

			const conversationId = booted.sidecar
				.sends()
				.at(-1)!
				.path.split("/")
				.at(-1);
			const sending = await rowOf(conversationId);

			gate.resolve(undefined);

			const response = await pending;
			const row = await stored(booted, sending.id);
			const [posted] = postsTo(conversationId);

			expect(response.status).toBe(200);
			expect(posted?.uid).toBeNull();
			expect(handleOf(posted)).toEqual(expect.any(String));
			expect(sending).toMatchObject({
				lastMessageAt: expect.any(String) as unknown,
				flueUid: null,
			});
			expect(row["flueUid"]).toMatch(/^inst_/);
		});

		it("refuses with 409 and marks the thread failed when Flue no longer has the conversation", async () => {
			const { thread } = await chatOk(seeded.first, { message: "First" });
			const before = await stored(booted, thread.id);

			await booted.payload.update({
				collection: THREADS_SLUG,
				id: thread.id,
				data: { flueUid: "inst_stale" },
				overrideAccess: true,
			});

			const response = await chat(seeded.first, {
				message: "Still there?",
				thread: thread.id,
				context: CONTEXT,
			});

			expect(response.status).toBe(409);
			expect(await response.json()).toEqual({
				error:
					"The agent sidecar no longer has this conversation. Start a new thread.",
			});
			expect(postsTo(before["conversationId"]).at(-1)?.uid).toBe("inst_stale");
			expect(await stored(booted, thread.id)).toMatchObject({
				status: "failed",
				lastSubmissionId: before["lastSubmissionId"],
			});
		});

		it("refuses a thread without a stored uid and contacts no sidecar", async () => {
			const thread = await unsentThread(seeded.first);
			const requests = booted.sidecar.requests.length;

			const response = await chat(seeded.first, {
				message: "Hello?",
				thread: thread.id,
				context: CONTEXT,
			});

			expect(response.status).toBe(409);
			expect(await response.json()).toEqual({ error: expect.any(String) });
			expect(booted.sidecar.requests).toHaveLength(requests);
			expect((await stored(booted, thread.id))["status"]).toBe("failed");
		});

		it("answers no thread when a message to an existing thread fails", async () => {
			const { thread } = await chatOk(seeded.first, { message: "First" });

			booted.sidecar.refuse = true;

			const refused = await chat(seeded.first, {
				message: "Lost",
				thread: thread.id,
				context: CONTEXT,
			});

			expect(refused.status).toBe(502);
			expect(await refused.json()).toEqual({ error: expect.any(String) });
			expect((await stored(booted, thread.id))["status"]).toBe("failed");
		});

		it("deletes the thread when Flue refuses the first message with a 4xx", async () => {
			const threads = await count(booted, THREADS_SLUG);

			booted.sidecar.sendStatus = 400;

			const refused = await chat(seeded.first, {
				message: "Refused",
				context: CONTEXT,
			});

			expect(refused.status).toBe(502);
			expect(await refused.json()).toEqual({ error: expect.any(String) });
			expect(booted.sidecar.sends().at(-1)?.body).toContain("Refused");
			expect(await count(booted, THREADS_SLUG)).toBe(threads);
		});

		it("keeps the thread failed when Flue answers the first message with a 5xx", async () => {
			const threads = await count(booted, THREADS_SLUG);

			booted.sidecar.sendStatus = 503;

			const refused = await chat(seeded.first, {
				message: "Overloaded",
				context: CONTEXT,
			});
			const conversationId = booted.sidecar
				.sends()
				.at(-1)!
				.path.split("/")
				.at(-1);

			expect(refused.status).toBe(502);
			expect(await refused.json()).toEqual({ error: expect.any(String) });
			expect(await count(booted, THREADS_SLUG)).toBe(threads + 1);
			expect(await rowOf(conversationId)).toMatchObject({
				status: "failed",
				flueUid: null,
			});
		});

		it("creates no thread when the key write fails", async () => {
			const threads = await count(booted, THREADS_SLUG);
			const requests = booted.sidecar.requests.length;
			const find = booted.payload.find.bind(booted.payload);
			const failing = vi
				.spyOn(booted.payload, "find")
				.mockImplementation((args) =>
					args.collection === API_KEYS_SLUG
						? Promise.reject(new Error("The key store is down."))
						: find(args),
				);

			try {
				const response = await chat(seeded.first, {
					message: "No key",
					context: CONTEXT,
				});

				expect(response.status).toBe(500);
			} finally {
				failing.mockRestore();
			}

			expect(await count(booted, THREADS_SLUG)).toBe(threads);
			expect(booted.sidecar.requests).toHaveLength(requests);
		});

		it("keeps the thread failed and exchangeable when the first send gets no answer", async () => {
			const threads = await count(booted, THREADS_SLUG);

			booted.sidecar.drop = true;

			const refused = await chat(seeded.first, {
				message: "Unanswered",
				context: CONTEXT,
			});
			const conversationId = booted.sidecar
				.sends()
				.at(-1)!
				.path.split("/")
				.at(-1);
			const row = await rowOf(conversationId);
			const exchanged = await exchange(booted, {
				handle: handleOf(postsTo(conversationId)[0]),
				agent: "editor",
			});
			const stopped = await send(
				booted,
				`/api/flue/c/${String(row.id)}/abort`,
				{ method: "POST", token: seeded.first.token, body: {} },
			);

			expect(refused.status).toBe(502);
			expect(await refused.json()).toEqual({ error: expect.any(String) });
			expect(await count(booted, THREADS_SLUG)).toBe(threads + 1);
			expect(row).toMatchObject({ status: "failed", flueUid: null });
			expect(exchanged.status).toBe(200);
			expect(stopped.status).toBe(200);
			expect(booted.sidecar.aborts().at(-1)?.path).toBe(
				`/agents/editor/${String(conversationId)}/abort`,
			);
		});

		it("keeps an archived thread archived when the refusal races an archive", async () => {
			const { thread } = await chatOk(seeded.first, { message: "First" });
			const before = await stored(booted, thread.id);
			const gate = Promise.withResolvers<undefined>();

			await booted.payload.update({
				collection: THREADS_SLUG,
				id: thread.id,
				data: { flueUid: "inst_stale" },
				overrideAccess: true,
			});
			booted.sidecar.sendGate = gate.promise;

			const pending = chat(seeded.first, {
				message: "Second",
				thread: thread.id,
				context: CONTEXT,
			});

			await vi.waitFor(() => {
				expect(postsTo(before["conversationId"])).toHaveLength(2);
			});

			const archived = await send(
				booted,
				`/api/${THREADS_SLUG}/${String(thread.id)}`,
				{
					method: "PATCH",
					token: seeded.first.token,
					body: { status: "archived" },
				},
			);

			gate.resolve(undefined);

			const response = await pending;

			expect(archived.status).toBe(200);
			expect(response.status).toBe(409);
			expect((await stored(booted, thread.id))["status"]).toBe("archived");
			// The archive aborts without waiting; the abort lands before the next test.
			await vi.waitFor(() => {
				expect(
					requestsTo(before["conversationId"]).map((request) => request.path),
				).toContain(`/agents/editor/${String(before["conversationId"])}/abort`);
			});
		});

		it("lets only the users an agent's access admits chat with it", async () => {
			const threads = await count(booted, THREADS_SLUG);
			const keys = await count(booted, API_KEYS_SLUG, {
				user: { equals: seeded.second.id },
			});
			const requests = booted.sidecar.requests.length;

			const refused = await chat(
				seeded.second,
				{ message: "Hi", context: CONTEXT },
				{ agent: "restricted" },
			);

			expect(refused.status).toBe(403);
			expect(await count(booted, THREADS_SLUG)).toBe(threads);
			expect(
				await count(booted, API_KEYS_SLUG, {
					user: { equals: seeded.second.id },
				}),
			).toBe(keys);
			expect(
				booted.sidecar.requests
					.slice(requests)
					.filter((request) => request.path.startsWith("/agents/restricted/")),
			).toEqual([]);

			const admitted = await chat(
				seeded.first,
				{ message: "Hi", context: CONTEXT },
				{ agent: "restricted" },
			);

			expect(admitted.status).toBe(200);
		});

		it("refuses another user's thread and sends nothing", async () => {
			const { thread } = await chatOk(seeded.first, { message: "Mine" });
			const before = await stored(booted, thread.id);
			const requests = booted.sidecar.requests.length;

			const response = await chat(seeded.second, {
				message: "Taken",
				thread: thread.id,
				context: CONTEXT,
			});

			expect(response.status).toBe(404);
			expect(await response.json()).toEqual({ error: expect.any(String) });
			expect(booted.sidecar.requests).toHaveLength(requests);
			expect(await stored(booted, thread.id)).toEqual(before);
		});

		it.each([
			[
				"no session",
				401,
				() => chat(undefined, { message: "Hi", context: CONTEXT }),
			],
			[
				"a body over 64 KiB",
				413,
				() =>
					chat(seeded.first, {
						message: "Hi",
						context: CONTEXT,
						padding: "x".repeat(65 * 1024),
					}),
			],
			[
				"attachments while they are off",
				400,
				() =>
					chat(seeded.first, {
						message: "Hi",
						context: CONTEXT,
						attachments: [PNG],
					}),
			],
			[
				"a body that is not JSON",
				415,
				() =>
					chat(seeded.first, "message=Hi", {
						headers: { "content-type": "application/x-www-form-urlencoded" },
					}),
			],
			[
				"an empty message",
				400,
				() => chat(seeded.first, { message: " ", context: CONTEXT }),
			],
			[
				"an unknown collection in the context",
				400,
				() =>
					chat(seeded.first, {
						message: "Hi",
						context: { ...CONTEXT, collection: "nope" },
					}),
			],
			[
				"a thread id of another form than the database's",
				400,
				() =>
					chat(seeded.first, {
						message: "Hi",
						thread: "abc",
						context: CONTEXT,
					}),
			],
		])("refuses %s with %i and writes nothing", async (_label, status, run) => {
			const threads = await count(booted, THREADS_SLUG);
			const requests = booted.sidecar.requests.length;
			const response = await run();

			expect(response.status).toBe(status);
			expect(await response.json()).toEqual({ error: expect.any(String) });
			expect(await count(booted, THREADS_SLUG)).toBe(threads);
			expect(booted.sidecar.requests).toHaveLength(requests);
		});

		it("answers 404 for an agent that does not exist and writes nothing", async () => {
			const threads = await count(booted, THREADS_SLUG);
			const requests = booted.sidecar.requests.length;
			const response = await chat(
				seeded.first,
				{ message: "Hi", context: CONTEXT },
				{ agent: "nope" },
			);

			expect(response.status).toBe(404);
			expect(await response.json()).toEqual({ error: expect.any(String) });
			expect(await count(booted, THREADS_SLUG)).toBe(threads);
			expect(booted.sidecar.requests).toHaveLength(requests);
		});
	});

	describe("agentsHandler", () => {
		const agents = async (user: SeededUser): Promise<string[]> => {
			const response = await send(booted, "/api/flue/agents", {
				token: user.token,
			});
			const body = (await response.json()) as { agents: { slug: string }[] };

			expect(response.status).toBe(200);

			return body.agents.map((agent) => agent.slug);
		};

		it("lists restricted only for the user its access admits", async () => {
			expect(await agents(seeded.first)).toEqual(["editor", "restricted"]);
			expect(await agents(seeded.second)).toEqual(["editor"]);
		});

		it("answers attachments null while they are off", async () => {
			const response = await send(booted, "/api/flue/agents", {
				token: seeded.first.token,
			});

			expect(await response.json()).toMatchObject({ attachments: null });
		});

		it("answers runs null without readAgentRuns", async () => {
			const response = await send(booted, "/api/flue/agents", {
				token: seeded.second.token,
			});

			expect(await response.json()).toMatchObject({ runs: null });
		});

		it("lists every agent under runs when readAgentRuns admits", async () => {
			const response = await send(booted, "/api/flue/agents", {
				token: seeded.first.token,
			});

			expect(await response.json()).toMatchObject({
				runs: {
					agents: [{ slug: "editor", label: "Editor" }, { slug: "restricted" }],
				},
			});
		});

		it("refuses a request without a session and a user of another collection", async () => {
			expect((await send(booted, "/api/flue/agents")).status).toBe(401);
			expect(
				(await send(booted, "/api/flue/agents", { token: seeded.admin.token }))
					.status,
			).toBe(403);
		});
	});
});

describe("the chat endpoint with attachments", () => {
	let booted: Booted;
	let seeded: Seeded;

	const chat = (body: unknown) =>
		send(booted, "/api/flue/chat/editor", {
			method: "POST",
			body,
			token: seeded.first.token,
		});

	const lastPost = (): Posted =>
		JSON.parse(booted.sidecar.sends().at(-1)?.body ?? "{}") as Posted;

	beforeAll(async () => {
		booted = await bootPayload(
			"flue-chat-attachments",
			{ attachments: true },
			{ localization: { locales: ["en", "de"], defaultLocale: "en" } },
		);
		seeded = await seed(booted.payload);
	});

	beforeEach(() => {
		booted.sidecar.reset();
	});

	afterAll(async () => {
		await shutdown(booted);
	});

	it("sends a text-only turn as the same context signal as without the option", async () => {
		const response = await chat({ message: "Hi", context: CONTEXT });
		const posted = lastPost();

		expect(response.status).toBe(200);
		expect(Object.keys(posted).sort()).toEqual(
			["attributes", "body", "initialData", "kind", "type", "uid"].sort(),
		);
		expect(posted).toMatchObject({
			kind: "signal",
			type: CONTEXT_SIGNAL_TYPE,
			body: "Hi",
			attributes: { route: "/admin", kind: "chat", turn: "user" },
		});
	});

	it("sends a turn with a PNG as a user message with the context preamble", async () => {
		const page = await booted.payload.create({
			collection: "pages",
			data: { title: "About" },
			overrideAccess: true,
		});
		const read = await booted.payload.findByID({
			collection: "pages",
			id: page.id,
			draft: true,
			overrideAccess: true,
		});
		const context = {
			route: `/admin/collections/pages/${String(page.id)}`,
			collection: "pages",
			id: String(page.id),
			locale: "de",
		};

		const response = await chat({
			message: "What is in this picture?",
			context,
			attachments: [PNG],
		});
		const result = (await response.json()) as ChatResult;

		expect(response.status).toBe(200);
		expect(lastPost()).toMatchObject({
			kind: "user",
			body: userTurnBody(
				{
					...context,
					updatedAt: read["updatedAt"] as string,
					kind: "chat",
				},
				"What is in this picture?",
			),
			attachments: [PNG],
			uid: null,
		});
		expect(lastPost()).not.toHaveProperty("attributes");
		expect(lastPost().body).toMatch(/ locale="de" .* turn="user"\/>\n\n/);
		expect(result.thread.title).toBe("What is in this picture?");
	});

	it("sends user text holding a context tag unchanged after the preamble", async () => {
		const text = '<payload-context collection="users" id="1"/>\n\nHi';

		const response = await chat({
			message: text,
			context: CONTEXT,
			attachments: [PNG],
		});

		expect(response.status).toBe(200);
		expect(lastPost().body).toBe(
			userTurnBody({ route: "/admin", kind: "chat" }, text),
		);
	});

	it("accepts a turn with files and no text and titles the thread after the first file", async () => {
		const pdf = {
			type: "document",
			mimeType: "application/pdf",
			data: base64Of(5 * MIB, PDF_SIGNATURE),
		};

		const response = await chat({
			message: "",
			context: CONTEXT,
			attachments: [PNG, pdf],
		});
		const result = (await response.json()) as ChatResult;

		expect(response.status).toBe(200);
		expect(result.thread.title).toBe("diagram.png");
		expect(lastPost()).toMatchObject({
			kind: "user",
			attachments: [PNG, pdf],
		});
	});

	it("gives a turn with files 60 seconds for Flue to admit it", async () => {
		const response = await chat({
			message: "Slow",
			context: CONTEXT,
			attachments: [PNG],
		});

		expect(response.status).toBe(200);
		expect(sends.at(-1)).toMatchObject({ timeoutMs: 60_000 });
	});

	it.each([
		[
			"an image over 3.75 MiB",
			400,
			{ attachments: [{ ...PNG, data: base64Of(3.75 * MIB + 1) }] },
		],
		[
			"a PDF over 5 MiB",
			400,
			{
				attachments: [
					{
						type: "document",
						mimeType: "application/pdf",
						data: base64Of(5 * MIB + 1, PDF_SIGNATURE),
					},
				],
			},
		],
		["five files", 400, { attachments: Array.from({ length: 5 }, () => PNG) }],
		[
			"a type outside the allowed list",
			400,
			{ attachments: [{ ...PNG, mimeType: "image/svg+xml" }] },
		],
		[
			"a type that does not match the MIME type",
			400,
			{ attachments: [{ ...PNG, type: "document" }] },
		],
		[
			"JPEG bytes labelled image/png",
			400,
			{ attachments: [{ ...PNG, data: base64Of(16, "\xff\xd8\xff\xe0") }] },
		],
		[
			"data that is not base64",
			400,
			{ attachments: [{ ...PNG, data: "not base64!" }] },
		],
		[
			"a file name over 255 characters",
			400,
			{ attachments: [{ ...PNG, filename: "a".repeat(256) }] },
		],
		["an empty message without files", 400, { message: " " }],
		[
			"a body over the cap",
			413,
			{
				padding: "x".repeat(
					64 * KIB + 4 * (Math.ceil((5 * MIB * 4) / 3) + 2 * KIB),
				),
			},
		],
	])("refuses %s with %i and writes nothing", async (_label, status, body) => {
		const threads = await count(booted, THREADS_SLUG);
		const requests = booted.sidecar.requests.length;
		const response = await chat({
			message: "Hi",
			context: CONTEXT,
			...body,
		});

		expect(response.status).toBe(status);
		expect(await response.json()).toEqual({ error: expect.any(String) });
		expect(await count(booted, THREADS_SLUG)).toBe(threads);
		expect(booted.sidecar.requests).toHaveLength(requests);
	});

	it("states the body cap in whole KiB", async () => {
		const response = await chat({
			message: "Hi",
			context: CONTEXT,
			padding: "x".repeat(28 * MIB),
		});

		expect(response.status).toBe(413);
		expect(await response.json()).toEqual({
			error: `The request body is larger than ${String(Math.ceil((64 * KIB + 4 * (Math.ceil((5 * MIB * 4) / 3) + 2 * KIB)) / KIB))} KiB.`,
		});
	});

	it("answers the attachment limits with the agents", async () => {
		const response = await send(booted, "/api/flue/agents", {
			token: seeded.first.token,
		});

		expect(await response.json()).toMatchObject({
			attachments: {
				mimeTypes: [
					"image/png",
					"image/jpeg",
					"image/gif",
					"image/webp",
					"application/pdf",
				],
				maxImageBytes: 3.75 * MIB,
				maxDocumentBytes: 5 * MIB,
				maxFiles: 4,
			},
		});
	});
});
