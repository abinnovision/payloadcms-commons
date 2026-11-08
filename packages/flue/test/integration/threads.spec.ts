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
	count,
	enableEditorKey,
	exchange,
	keyEnabled,
	seed,
	send,
	shutdown,
	stored,
	THREADS_SLUG,
} from "./helpers/payload.js";
import { flueApi } from "../../src/admin/api.js";
import { handleHash } from "../../src/threads/handle.js";
import { SIDECAR_SECRET, EDITOR } from "../fixtures/config.js";

import type { Booted, Doc, Seeded, SeededUser } from "./helpers/payload.js";

interface Owner {
	relationTo: "admins" | "users";
	value: number | string;
}

describe("flue-threads", () => {
	let booted: Booted;
	let seeded: Seeded;
	let agentUserId: number | string;

	const owned = (user: SeededUser): Owner => ({
		relationTo: "users",
		value: user.id,
	});

	// A thread as the plugin writes it, past access control.
	const createThread = async (
		createdBy: Owner,
		data: Record<string, unknown> = {},
	): Promise<Doc> =>
		await booted.payload.create({
			collection: THREADS_SLUG,
			data: {
				agent: EDITOR.slug,
				kind: "chat",
				conversationId: randomUUID(),
				handleHash: handleHash(randomUUID()),
				createdBy,
				...data,
			},
			overrideAccess: true,
		});

	/*
	 * The whole row past access control. `updatedAt` and `updatedBy` are left
	 * out: an update whose fields access control drops still touches them.
	 */
	const comparable = async (id: number | string): Promise<Doc> => {
		const { updatedAt: _at, updatedBy: _by, ...row } = await stored(booted, id);

		return row;
	};

	const read = (id: number | string, user: SeededUser) =>
		send(booted, `/api/${THREADS_SLUG}/${String(id)}`, { token: user.token });

	const list = async (
		ids: (number | string)[],
		user: SeededUser,
	): Promise<(number | string)[]> => {
		const query = new URLSearchParams({ "where[id][in]": ids.join(",") });
		const response = await send(
			booted,
			`/api/${THREADS_SLUG}?${query.toString()}`,
			{
				token: user.token,
			},
		);

		expect(response.status).toBe(200);

		return ((await response.json()) as { docs: Doc[] }).docs.map(
			(doc) => doc.id,
		);
	};

	const patch = (id: number | string, user: SeededUser, body: unknown) =>
		send(booted, `/api/${THREADS_SLUG}/${String(id)}`, {
			method: "PATCH",
			token: user.token,
			body,
		});

	beforeAll(async () => {
		booted = await bootPayload("flue-threads");
		seeded = await seed(booted.payload);
		agentUserId = (
			await booted.payload.create({
				collection: "users",
				data: { email: "agent@example.com", password: "agent-secret" },
				overrideAccess: true,
			})
		).id;
	});

	beforeEach(() => {
		booted.sidecar.reset();
	});

	afterAll(async () => {
		await shutdown(booted);
	});

	describe("read", () => {
		it("gives each user their own threads only", async () => {
			const first = await createThread(owned(seeded.first));
			const second = await createThread(owned(seeded.second));
			const ids = [first.id, second.id];

			expect(await list(ids, seeded.first)).toEqual([first.id]);
			expect(await list(ids, seeded.second)).toEqual([second.id]);
			expect((await read(second.id, seeded.first)).status).toBe(404);
		});

		it("pages rows with the same message time by id, skipping and repeating none", async () => {
			const lastMessageAt = "2026-11-08T10:00:00.000Z";
			const title = `keyset ${randomUUID()}`;
			const tied = await Promise.all(
				[1, 2, 3].map(() =>
					createThread(owned(seeded.first), { title, lastMessageAt }),
				),
			);

			const untimed = await createThread(owned(seeded.first), { title });
			const api = flueApi({
				serverURL: "",
				apiRoute: "/api",
				endpointPath: "/flue",
				threadsSlug: THREADS_SLUG,
				mcpxEndpointPath: "/mcpx",
			});
			const filter = { kind: "chat", agent: EDITOR.slug, title } as const;

			// The admin's own query string, through Payload's REST router.
			vi.stubGlobal("fetch", (url: string, init?: RequestInit) =>
				send(booted, url, {
					method: init?.method ?? "GET",
					token: seeded.first.token,
				}),
			);

			try {
				const first = await api.threads(filter, { limit: 2 });
				const last = first.docs.at(-1)!;
				const second = await api.threads(filter, {
					limit: 2,
					after: { lastMessageAt, id: last.id },
				});
				const listed = [...first.docs, ...second.docs].map((doc) => doc.id);

				expect(first.hasNextPage).toBe(true);
				expect(second.hasNextPage).toBe(false);
				expect(listed).toEqual(
					tied.map((doc) => doc.id).sort((a, b) => Number(b) - Number(a)),
				);
				expect(listed).not.toContain(untimed.id);
			} finally {
				vi.unstubAllGlobals();
			}
		});

		it("gives an admins user with a colliding id none of them", async () => {
			const thread = await createThread(owned(seeded.first));
			const response = await send(booted, `/api/${THREADS_SLUG}`, {
				token: seeded.admin.token,
			});

			expect(response.status).toBe(403);
			expect((await read(thread.id, seeded.admin)).status).toBe(403);
		});

		it("refuses a users user a thread created by the admins user with the same id", async () => {
			const thread = await createThread({
				relationTo: "admins",
				value: seeded.admin.id,
			});

			expect(await list([thread.id], seeded.first)).toEqual([]);
			expect((await read(thread.id, seeded.first)).status).toBe(404);
		});

		it("leaves conversationId, handleHash and agentTitle out of REST responses", async () => {
			const thread = await createThread(owned(seeded.first), {
				agentTitle: "From the agent",
			});
			const response = await read(thread.id, seeded.first);
			const doc = (await response.json()) as Doc;

			expect(response.status).toBe(200);
			expect(doc).not.toHaveProperty("conversationId");
			expect(doc).not.toHaveProperty("handleHash");
			expect(doc).not.toHaveProperty("agentTitle");
		});

		it("lets readAgentRuns widen read to agent runs without granting update", async () => {
			const thread = await createThread(
				{ relationTo: "users", value: agentUserId },
				{ kind: "reactive", title: "Run" },
			);
			const before = await comparable(thread.id);

			expect((await read(thread.id, seeded.first)).status).toBe(200);
			expect((await read(thread.id, seeded.second)).status).toBe(404);

			const statuses = await Promise.all(
				[seeded.first, seeded.second].map(
					async (user) =>
						(await patch(thread.id, user, { title: "Taken" })).status,
				),
			);

			expect(statuses).toEqual([403, 403]);

			expect(await comparable(thread.id)).toEqual(before);
		});
	});

	describe("update", () => {
		it("lets the owner rename, mark read and archive, and nobody else", async () => {
			const thread = await createThread(owned(seeded.first));
			const before = await comparable(thread.id);

			expect(
				(await patch(thread.id, seeded.second, { title: "Taken" })).status,
			).toBe(403);
			expect(await comparable(thread.id)).toEqual(before);

			const lastReadAt = new Date().toISOString();

			expect(
				(await patch(thread.id, seeded.first, { title: "Renamed", lastReadAt }))
					.status,
			).toBe(200);
			expect(
				(await patch(thread.id, seeded.first, { status: "archived" })).status,
			).toBe(200);
			expect(await comparable(thread.id)).toMatchObject({
				title: "Renamed",
				lastReadAt,
				status: "archived",
			});
		});

		it.each([
			["status idle", { status: "idle" }, 400],
			["kind", { kind: "ambient" }, 200],
			["agent", { agent: "restricted" }, 200],
			["dispatchJob", { dispatchJob: "job-1" }, 200],
		])(
			"keeps %s from the owner and the row unchanged",
			async (_label, body, status) => {
				const thread = await createThread(owned(seeded.first), {
					status: "failed",
				});
				const before = await comparable(thread.id);

				expect((await patch(thread.id, seeded.first, body)).status).toBe(
					status,
				);
				expect(await comparable(thread.id)).toEqual(before);
			},
		);
	});

	describe("create and delete", () => {
		it("refuses both through the API", async () => {
			const thread = await createThread(owned(seeded.first));
			const before = await count(booted, THREADS_SLUG);

			const created = await send(booted, `/api/${THREADS_SLUG}`, {
				method: "POST",
				token: seeded.first.token,
				body: { agent: EDITOR.slug, title: "Mine" },
			});
			const deleted = await send(
				booted,
				`/api/${THREADS_SLUG}/${String(thread.id)}`,
				{ method: "DELETE", token: seeded.first.token },
			);

			expect(created.status).toBe(403);
			expect(deleted.status).toBe(403);
			expect(await count(booted, THREADS_SLUG)).toBe(before);
		});
	});

	describe("archiving a thread with a conversation", () => {
		const startRun = async (user: SeededUser, status = "running") => {
			const conversationId = randomUUID();
			const handle = randomUUID();
			const apiKeyId = await enableEditorKey(booted, user.id);
			const thread = await createThread(owned(user), {
				status,
				conversationId,
				handleHash: handleHash(handle),
			});

			const aborts = () =>
				booted.sidecar
					.aborts()
					.filter((request) => request.path.includes(conversationId));
			const exchanged = async () =>
				(await exchange(booted, { handle, agent: EDITOR.slug })).status;

			return { thread, conversationId, aborts, exchanged, apiKeyId };
		};

		it("aborts the run once, disables the key, and the handle no longer exchanges", async () => {
			const run = await startRun(seeded.first);

			expect(await run.exchanged()).toBe(200);
			expect(
				(await patch(run.thread.id, seeded.first, { status: "archived" }))
					.status,
			).toBe(200);
			expect(await run.exchanged()).toBe(404);
			expect(await keyEnabled(booted, run.apiKeyId)).toBe(false);
			await vi.waitFor(() => {
				expect(run.aborts()).toEqual([
					expect.objectContaining({
						path: `/agents/editor/${run.conversationId}/abort`,
						headers: expect.objectContaining({
							authorization: `Bearer ${SIDECAR_SECRET}`,
						}) as unknown,
					}),
				]);
			});
		});

		it("answers before the sidecar answers the abort", async () => {
			const run = await startRun(seeded.first);
			const gate = Promise.withResolvers<undefined>();

			booted.sidecar.abortGate = gate.promise;

			try {
				expect(
					(await patch(run.thread.id, seeded.first, { status: "archived" }))
						.status,
				).toBe(200);
				expect(await keyEnabled(booted, run.apiKeyId)).toBe(false);
			} finally {
				gate.resolve(undefined);
			}

			await vi.waitFor(() => {
				expect(run.aborts()).toHaveLength(1);
			});
		});

		it("logs no failure when Flue has not seen the conversation", async () => {
			const run = await startRun(seeded.first);
			const logged = vi.spyOn(booted.payload.logger, "error");

			booted.sidecar.abortStatus = 404;

			try {
				expect(
					(await patch(run.thread.id, seeded.first, { status: "archived" }))
						.status,
				).toBe(200);
				await vi.waitFor(() => {
					expect(run.aborts()).toHaveLength(1);
				});
				// The hook reads the answer shortly after the sidecar records the request.
				await new Promise((resolve) => {
					setTimeout(resolve, 50);
				});
				expect(logged).not.toHaveBeenCalled();
			} finally {
				logged.mockRestore();
			}
		});

		it("aborts the run of a thread whose status is not running and keeps the key", async () => {
			const run = await startRun(seeded.first, "idle");

			expect(
				(await patch(run.thread.id, seeded.first, { status: "archived" }))
					.status,
			).toBe(200);
			// The key stays enabled, so only the archive refuses the handle.
			expect(await run.exchanged()).toBe(404);
			expect(await keyEnabled(booted, run.apiKeyId)).toBe(true);
			await vi.waitFor(() => {
				expect(run.aborts()).toHaveLength(1);
			});
		});

		it("is refused to another user, leaving the run alone", async () => {
			const run = await startRun(seeded.second);

			expect(
				(await patch(run.thread.id, seeded.first, { status: "archived" }))
					.status,
			).toBe(403);
			expect(await run.exchanged()).toBe(200);
			expect(await keyEnabled(booted, run.apiKeyId)).toBe(true);
			expect(run.aborts()).toEqual([]);
		});
	});
});
