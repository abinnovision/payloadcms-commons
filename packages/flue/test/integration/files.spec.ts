import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
	enableEditorKey,
	login,
	seed,
	send,
	shutdown,
	stored,
	THREADS_SLUG,
} from "./helpers/payload.js";
import { readUserTurnBody } from "../../src/protocol/context.js";
import { INITIAL_DATA_KEY } from "../../src/protocol/exchange.js";
import { handleHash } from "../../src/threads/handle.js";
import { SIDECAR_SECRET } from "../fixtures/config.js";

import type { Booted, Doc, Seeded, SeededUser } from "./helpers/payload.js";
import type { FlueFileOptions } from "../../src/index.js";
import type { WorkspaceFile } from "../../src/protocol/files.js";
import type { CollectionConfig } from "payload";

const FILES_SLUG = "flue-files";
const CONTEXT = { route: "/admin" };
const MIB = 1024 * 1024;

// A text file long enough for a range read, with a marker no turn body may hold.
const NOTE = `MARKER-${"x".repeat(200)}\n`;

// A valid one-pixel PNG.
const PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
	"base64",
);

interface Posted {
	kind: string;
	type: string;
	body: string;
	initialData?: Record<string, { handle: string }>;
}

interface Chat {
	thread: number | string;
	conversationId: string;
	posted: Posted;
	/** Set on a thread's first turn. */
	handle: string | undefined;
}

// Set by a test that needs the files collection's deletes to fail.
let failDeletes = false;

/*
 * Stores files below a temporary directory and fails deletes on demand, as
 * a storage outage would.
 */
const withTestStorage =
	(dir: string) =>
	(collection: CollectionConfig): CollectionConfig => ({
		...collection,
		upload: {
			...(collection.upload as object),
			staticDir: join(dir, "store"),
		},
		hooks: {
			...collection.hooks,
			beforeDelete: [
				() => {
					if (failDeletes) {
						throw new Error("The storage is unavailable.");
					}
				},
			],
		},
	});

const bootWithFiles = async (
	cacheKey: string,
	dir: string,
	files: FlueFileOptions = {},
): Promise<Booted> =>
	await bootPayload(
		cacheKey,
		{ files: { overrideCollection: withTestStorage(dir), ...files } },
		{ upload: { useTempFiles: true, tempFileDir: join(dir, "tmp") } },
	);

describe("the file workspace", () => {
	let dir: string;
	let booted: Booted;
	let seeded: Seeded;

	const upload = (
		user: SeededUser,
		name: string,
		bytes: BlobPart,
		type = "text/plain",
		data?: Record<string, unknown>,
	): Promise<Response> => {
		const form = new FormData();

		form.append("file", new File([bytes], name, { type }));

		if (data) {
			form.append("_payload", JSON.stringify(data));
		}

		return send(booted, `/api/${FILES_SLUG}`, {
			method: "POST",
			token: user.token,
			body: form,
		});
	};

	const uploaded = async (
		user: SeededUser,
		name = "note.txt",
		bytes: BlobPart = NOTE,
		type = "text/plain",
	): Promise<Doc> => {
		const response = await upload(user, name, bytes, type);

		expect(response.status).toBe(201);

		return ((await response.json()) as { doc: Doc }).doc;
	};

	const fileRow = async (id: number | string): Promise<Doc | null> =>
		await booted.payload.findByID({
			collection: FILES_SLUG,
			id,
			depth: 0,
			overrideAccess: true,
			disableErrors: true,
		});

	const threadOf = async (id: number | string): Promise<unknown> =>
		(await fileRow(id))?.["thread"] ?? null;

	const freshUser = async (): Promise<SeededUser> => {
		const credentials = {
			email: `${randomUUID()}@example.com`,
			password: "fresh-secret",
		};
		const user = await booted.payload.create({
			collection: "users",
			data: credentials,
			overrideAccess: true,
		});

		return {
			id: user.id,
			token: await login(booted.payload, "users", credentials),
		};
	};

	// A pending file row of `user` without bytes, to fill the pending caps.
	const pendingRow = async (user: SeededUser, filesize: number) =>
		await booted.payload.db.create({
			collection: FILES_SLUG,
			data: {
				name: "seeded.txt",
				filename: `${randomUUID()}.txt`,
				mimeType: "text/plain",
				filesize,
				createdBy: { relationTo: "users", value: user.id },
			},
		});

	const makeStale = async (id: number | string): Promise<void> => {
		await booted.payload.db.updateOne({
			collection: FILES_SLUG,
			id,
			data: { createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) },
		});
	};

	const chat = (user: SeededUser, body: Record<string, unknown>) =>
		send(booted, "/api/flue/chat/editor", {
			method: "POST",
			token: user.token,
			body: { context: CONTEXT, ...body },
		});

	const chatOk = async (
		user: SeededUser,
		body: Record<string, unknown>,
	): Promise<Chat> => {
		const response = await chat(user, body);

		expect(response.status).toBe(200);

		const { thread } = (await response.json()) as {
			thread: { id: number | string };
		};
		const conversationId = (await stored(booted, thread.id))[
			"conversationId"
		] as string;
		const request = booted.sidecar
			.sends()
			.findLast((candidate) => candidate.path.endsWith(`/${conversationId}`));
		const posted = JSON.parse(request?.body ?? "{}") as Posted;

		return {
			thread: thread.id,
			conversationId,
			posted,
			handle: posted.initialData?.[INITIAL_DATA_KEY]?.handle,
		};
	};

	const archive = (user: SeededUser, thread: number | string) =>
		send(booted, `/api/${THREADS_SLUG}/${String(thread)}`, {
			method: "PATCH",
			token: user.token,
			body: { status: "archived" },
		});

	beforeAll(async () => {
		dir = await mkdtemp(join(tmpdir(), "flue-files-"));
		booted = await bootWithFiles("flue-files", dir, {
			// PNG is left out, so a PNG named .pdf meets Payload's content check.
			mimeTypes: ["application/pdf", "text/plain", "text/markdown"],
			maxFilesPerTurn: 2,
			maxFilesPerThread: 3,
		});
		seeded = await seed(booted.payload);
	});

	beforeEach(() => {
		booted.sidecar.reset();
		failDeletes = false;
	});

	afterAll(async () => {
		await shutdown(booted);
		await rm(dir, { recursive: true, force: true });
	});

	describe("gET /api/flue/agents", () => {
		it("answers the file workspace limits for the panel", async () => {
			const response = await send(booted, "/api/flue/agents", {
				token: seeded.first.token,
			});

			expect(await response.json()).toMatchObject({
				files: {
					slug: FILES_SLUG,
					mimeTypes: ["application/pdf", "text/plain", "text/markdown"],
					maxFiles: 2,
				},
			});
		});
	});

	describe(`POST /api/${FILES_SLUG}`, () => {
		it("stores the file under a random name and keeps the uploader's name", async () => {
			const doc = await uploaded(seeded.first, "Briefing Spring.txt");

			expect(doc["filename"]).toMatch(/^[\da-f-]{36}\.txt$/);
			expect(doc["name"]).toBe("Briefing Spring.txt");
		});

		it("gives two users uploading the same name no trace of each other", async () => {
			const first = await uploaded(seeded.first, "a.txt");
			const second = await uploaded(seeded.second, "a.txt");

			expect(first["name"]).toBe("a.txt");
			expect(second["name"]).toBe("a.txt");
			expect(second["filename"]).not.toMatch(/^a(-\d+)?\.txt$/);
			expect(second["filename"]).not.toBe(first["filename"]);
		});

		it("ignores a thread the uploader sets", async () => {
			const { thread } = await chatOk(seeded.first, { message: "Hello" });
			const response = await upload(seeded.first, "x.txt", NOTE, "text/plain", {
				thread,
			});
			const { doc } = (await response.json()) as { doc: Doc };

			expect(response.status).toBe(201);
			expect(await threadOf(doc.id)).toBeNull();
		});

		it("refuses a PNG named .pdf with temp files on and stores nothing", async () => {
			const before = await count(booted, FILES_SLUG);
			const response = await upload(
				seeded.first,
				"diagram.pdf",
				PNG,
				"application/pdf",
			);

			expect(response.status).toBe(400);
			expect(await count(booted, FILES_SLUG)).toBe(before);
		});

		it("refuses a file from a URL and fetches nothing", async () => {
			const before = await count(booted, FILES_SLUG);
			const requests = booted.sidecar.requests.length;
			const response = await send(booted, `/api/${FILES_SLUG}`, {
				method: "POST",
				token: seeded.first.token,
				body: {
					filename: "remote.txt",
					url: `${booted.sidecar.url}/remote.txt`,
					name: "remote.txt",
				},
			});

			expect(response.status).toBe(400);
			expect(await count(booted, FILES_SLUG)).toBe(before);
			expect(booted.sidecar.requests).toHaveLength(requests);
		});

		it("refuses a declared type outside the allowed ones", async () => {
			const before = await count(booted, FILES_SLUG);

			expect(
				(await upload(seeded.first, "a.png", PNG, "image/png")).status,
			).toBe(400);
			expect(await count(booted, FILES_SLUG)).toBe(before);
		});

		it("refuses the 21st pending file of a user", async () => {
			const user = await freshUser();

			for (let index = 0; index < 20; index++) {
				// eslint-disable-next-line no-await-in-loop
				await pendingRow(user, 10);
			}

			const response = await upload(user, "one-more.txt", NOTE);

			expect(response.status).toBe(400);
			expect(
				await count(booted, FILES_SLUG, { name: { equals: "one-more.txt" } }),
			).toBe(0);
		});

		it("refuses a file past the pending bytes of a user", async () => {
			const user = await freshUser();

			await pendingRow(user, 300 * MIB - 10);

			const response = await upload(user, "overflow.txt", NOTE);

			expect(response.status).toBe(400);
			expect(
				await count(booted, FILES_SLUG, { name: { equals: "overflow.txt" } }),
			).toBe(0);
		});

		it("removes the uploader's stale pending files and not another user's", async () => {
			const own = await uploaded(seeded.first);
			const other = await uploaded(seeded.second);

			await makeStale(own.id);
			await makeStale(other.id);
			await uploaded(seeded.first);

			expect(await fileRow(own.id)).toBeNull();
			expect(await fileRow(other.id)).not.toBeNull();
		});
	});

	describe(`reading and deleting ${FILES_SLUG}`, () => {
		it("lets the owner read a pending file, and nobody else", async () => {
			const doc = await uploaded(seeded.first);
			const path = `/api/${FILES_SLUG}/file/${String(doc["filename"])}`;

			expect(
				(
					await send(booted, `/api/${FILES_SLUG}/${String(doc.id)}`, {
						token: seeded.first.token,
					})
				).status,
			).toBe(200);
			expect(
				(
					await send(booted, `/api/${FILES_SLUG}/${String(doc.id)}`, {
						token: seeded.second.token,
					})
				).status,
			).toBe(404);

			const own = await send(booted, path, { token: seeded.first.token });

			expect(own.status).toBe(200);
			expect(await own.text()).toBe(NOTE);
			expect(
				(await send(booted, path, { token: seeded.second.token })).status,
			).toBe(403);
		});

		it("lets the owner delete a pending file, and nobody else", async () => {
			const doc = await uploaded(seeded.first);
			const remove = (user: SeededUser) =>
				send(booted, `/api/${FILES_SLUG}/${String(doc.id)}`, {
					method: "DELETE",
					token: user.token,
				});

			expect((await remove(seeded.second)).status).not.toBe(200);
			expect(await fileRow(doc.id)).not.toBeNull();
			expect((await remove(seeded.first)).status).toBe(200);
			expect(await fileRow(doc.id)).toBeNull();
		});

		it("refuses the owner a delete of a file a turn claimed", async () => {
			const doc = await uploaded(seeded.first);

			await chatOk(seeded.first, { message: "Read this", files: [doc.id] });

			expect(
				(
					await send(booted, `/api/${FILES_SLUG}/${String(doc.id)}`, {
						method: "DELETE",
						token: seeded.first.token,
					})
				).status,
			).not.toBe(200);
			expect(await fileRow(doc.id)).not.toBeNull();
		});
	});

	describe("chatHandler with files", () => {
		it("sends the claimed files as references in a signal, without their bytes", async () => {
			const first = await uploaded(seeded.first, "spring.txt");
			const second = await uploaded(seeded.first, "autumn.txt");
			const { thread, posted } = await chatOk(seeded.first, {
				message: "Compare",
				files: [first.id, second.id],
			});
			const body = readUserTurnBody(posted.body);

			expect(posted).toMatchObject({ kind: "signal", type: "payload-context" });
			expect(posted.body).not.toContain("MARKER");
			expect(body?.text).toBe("Compare");
			expect(body?.files).toEqual([
				{
					id: String(first.id),
					name: "spring.txt",
					mimeType: "text/plain",
					size: NOTE.length,
				},
				{
					id: String(second.id),
					name: "autumn.txt",
					mimeType: "text/plain",
					size: NOTE.length,
				},
			]);

			// The turn references exactly what the thread holds.
			const { docs } = await booted.payload.find({
				collection: FILES_SLUG,
				where: { thread: { equals: thread } },
				overrideAccess: true,
			});

			expect(docs.map((doc) => String(doc.id)).sort()).toEqual(
				body?.files.map((file) => file.id).sort(),
			);
		});

		it("titles a new thread after its first file when the message is empty", async () => {
			const doc = await uploaded(seeded.first, "minutes.txt");
			const { thread } = await chatOk(seeded.first, {
				message: "",
				files: [doc.id],
			});

			expect((await stored(booted, thread))["title"]).toBe("minutes.txt");
		});

		describe("refusals", () => {
			/*
			 * A first turn's status, the thread rows and sends it added, and the
			 * threads of `files` afterwards.
			 */
			const firstTurn = async (
				body: Record<string, unknown>,
				files: Doc[] = [],
			) => {
				const threads = await count(booted, THREADS_SLUG);
				const sends = booted.sidecar.sends().length;
				const { status } = await chat(seeded.first, body);

				return {
					status,
					threads: (await count(booted, THREADS_SLUG)) - threads,
					sends: booted.sidecar.sends().length - sends,
					claimed: await Promise.all(files.map((doc) => threadOf(doc.id))),
				};
			};

			// A refusal writes no thread, claims no file and sends nothing.
			const refused = (status: number, files = 0) => ({
				status,
				threads: 0,
				sends: 0,
				claimed: Array.from({ length: files }, () => null),
			});

			it("refuses a file of another user", async () => {
				const own = await uploaded(seeded.first);
				const other = await uploaded(seeded.second);

				expect(
					await firstTurn({ message: "Read", files: [own.id, other.id] }, [
						own,
						other,
					]),
				).toEqual(refused(404, 2));
			});

			it("refuses a file another turn claimed", async () => {
				const claimed = await uploaded(seeded.first);
				const own = await uploaded(seeded.first);

				await chatOk(seeded.first, { message: "First", files: [claimed.id] });
				expect(
					await firstTurn({ message: "Again", files: [own.id, claimed.id] }, [
						own,
					]),
				).toEqual(refused(404, 1));
			});

			it("refuses more files than a turn takes", async () => {
				const docs = [
					await uploaded(seeded.first),
					await uploaded(seeded.first),
					await uploaded(seeded.first),
				];

				expect(
					await firstTurn(
						{ message: "All", files: docs.map((doc) => doc.id) },
						docs,
					),
				).toEqual(refused(400, 3));
			});

			it("refuses base64 attachments", async () => {
				expect(
					await firstTurn({
						message: "Inline",
						attachments: [
							{
								type: "document",
								mimeType: "text/plain",
								data: Buffer.from("a").toString("base64"),
							},
						],
					}),
				).toEqual(refused(400));
			});

			it("returns the files to pending when the sidecar refuses a first turn", async () => {
				const doc = await uploaded(seeded.first);

				booted.sidecar.sendStatus = 422;

				const turn = await firstTurn({ message: "Read", files: [doc.id] }, [
					doc,
				]);

				expect(turn).toMatchObject({ status: 502, threads: 0, sends: 1 });
				expect(turn.claimed).toEqual([null]);
			});

			it("refuses files past the thread's cap and claims none", async () => {
				const first = await uploaded(seeded.first);
				const second = await uploaded(seeded.first);
				const { thread } = await chatOk(seeded.first, {
					message: "Two",
					files: [first.id, second.id],
				});
				const more = [
					await uploaded(seeded.first),
					await uploaded(seeded.first),
				];
				const sends = booted.sidecar.sends().length;
				const response = await chat(seeded.first, {
					message: "Two more",
					thread,
					files: more.map((doc) => doc.id),
				});

				expect(response.status).toBe(400);
				expect(booted.sidecar.sends()).toHaveLength(sends);

				for (const doc of more) {
					// eslint-disable-next-line no-await-in-loop
					expect(await threadOf(doc.id)).toBeNull();
				}
			});
		});

		it("removes the user's stale pending files and not another user's", async () => {
			const own = await uploaded(seeded.second);
			const other = await uploaded(seeded.first);

			await makeStale(own.id);
			await makeStale(other.id);
			await chatOk(seeded.second, { message: "Hello" });

			expect(await fileRow(own.id)).toBeNull();
			expect(await fileRow(other.id)).not.toBeNull();
		});
	});

	describe("archiving a thread with files", () => {
		it("deletes the thread's files", async () => {
			const doc = await uploaded(seeded.first);
			const { thread } = await chatOk(seeded.first, {
				message: "Keep",
				files: [doc.id],
			});

			expect((await archive(seeded.first, thread)).status).toBe(200);
			// The delete runs after the archive, outside its transaction.
			await vi.waitFor(async () => {
				expect(await fileRow(doc.id)).toBeNull();
			});
			expect(
				(
					await send(
						booted,
						`/api/${FILES_SLUG}/file/${String(doc["filename"])}`,
						{
							token: seeded.first.token,
						},
					)
				).status,
			).not.toBe(200);
		});

		it("logs a failed delete and archives the thread", async () => {
			const doc = await uploaded(seeded.first);
			const { thread } = await chatOk(seeded.first, {
				message: "Keep",
				files: [doc.id],
			});
			const logged = vi.spyOn(booted.payload.logger, "error");

			failDeletes = true;

			try {
				expect((await archive(seeded.first, thread)).status).toBe(200);
				await vi.waitFor(() => {
					expect(logged).toHaveBeenCalledWith(
						expect.objectContaining({
							msg: "[payloadcms-flue] Could not delete the files of a thread.",
						}),
					);
				});
			} finally {
				logged.mockRestore();
			}

			expect((await stored(booted, thread))["status"]).toBe("archived");
			expect(await fileRow(doc.id)).not.toBeNull();
		});
	});

	describe("the sidecar file endpoints", () => {
		const list = (
			body: unknown,
			authorization = `Bearer ${SIDECAR_SECRET}`,
		): Promise<Response> =>
			send(booted, "/api/flue/files/list", {
				method: "POST",
				body,
				headers: { authorization },
			});

		const read = (
			id: number | string,
			args: {
				handle?: string | undefined;
				agent?: string;
				authorization?: string;
				query?: string;
				range?: string;
			} = {},
		): Promise<Response> =>
			send(booted, `/api/flue/files/${String(id)}${args.query ?? ""}`, {
				headers: {
					authorization: args.authorization ?? `Bearer ${SIDECAR_SECRET}`,
					"x-flue-handle": args.handle ?? "",
					"x-flue-agent": args.agent ?? "editor",
					...(args.range === undefined ? {} : { range: args.range }),
				},
			});

		let file: Doc;
		let other: Doc;
		let handle: string;

		beforeAll(async () => {
			file = await uploaded(seeded.first, "brief.txt");
			other = await uploaded(seeded.first, "other.txt");
			handle = (
				await chatOk(seeded.first, { message: "One", files: [file.id] })
			).handle!;
			await chatOk(seeded.first, { message: "Two", files: [other.id] });
		});

		it("lists the files of the handle's thread", async () => {
			const response = await list({ handle, agent: "editor" });

			expect(response.status).toBe(200);
			expect((await response.json()) as WorkspaceFile[]).toEqual([
				{
					id: file.id,
					name: "brief.txt",
					mimeType: "text/plain",
					size: NOTE.length,
					createdAt: expect.any(String) as unknown,
				},
			]);
		});

		it("reads a file of the handle's thread", async () => {
			const response = await read(file.id, { handle });

			expect(response.status).toBe(200);
			expect(await response.text()).toBe(NOTE);
		});

		it("answers a range with 206 and its bytes", async () => {
			const response = await read(file.id, { handle, range: "bytes=0-99" });

			expect(response.status).toBe(206);
			expect((await response.arrayBuffer()).byteLength).toBe(100);
		});

		it("ignores prefix, version and original in the query", async () => {
			const response = await read(file.id, {
				handle,
				query: "?prefix=elsewhere&original=true&version=1",
			});

			expect(response.status).toBe(200);
			expect(await response.text()).toBe(NOTE);
		});

		it("refuses a wrong secret", async () => {
			expect(
				(await list({ handle, agent: "editor" }, "Bearer wrong")).status,
			).toBe(401);
			expect(
				(await read(file.id, { handle, authorization: "Bearer wrong" })).status,
			).toBe(401);
		});

		it("lists nothing for a reactive thread", async () => {
			const reactive = randomUUID();

			await enableEditorKey(booted, seeded.first.id);
			await booted.payload.create({
				collection: THREADS_SLUG,
				data: {
					agent: "editor",
					kind: "reactive",
					conversationId: randomUUID(),
					handleHash: handleHash(reactive),
					createdBy: { relationTo: "users", value: seeded.first.id },
				},
				overrideAccess: true,
			});

			const response = await list({ handle: reactive, agent: "editor" });

			expect(response.status).toBe(200);
			expect(await response.json()).toEqual([]);
		});

		it("answers every refusal with the same 404 and no bytes", async () => {
			const archivedFile = await uploaded(seeded.first);
			const archived = await chatOk(seeded.first, {
				message: "Archive me",
				files: [archivedFile.id],
			});

			expect((await archive(seeded.first, archived.thread)).status).toBe(200);

			const expiring = await freshUser();
			const expiringFile = await uploaded(expiring);
			const expired = await chatOk(expiring, {
				message: "Expire me",
				files: [expiringFile.id],
			});

			await booted.payload.update({
				collection: API_KEYS_SLUG,
				where: { user: { equals: expiring.id } },
				data: { expiresAt: new Date(Date.now() - 1000).toISOString() },
				overrideAccess: true,
			});

			const refusals = [
				await read(other.id, { handle }),
				await read(file.id, { handle, agent: "restricted" }),
				await read(archivedFile.id, { handle: archived.handle }),
				await read(expiringFile.id, { handle: expired.handle }),
				await read(file.id, { handle: randomUUID() }),
				await read("not-an-id", { handle }),
				await list({ handle: archived.handle, agent: "editor" }),
				await list({ handle, agent: "restricted" }),
				await list({ handle: expired.handle, agent: "editor" }),
				await list({ handle: randomUUID(), agent: "editor" }),
			];

			for (const response of refusals) {
				expect(response.status).toBe(404);
				// eslint-disable-next-line no-await-in-loop
				expect(await response.json()).toEqual({
					error: "No live conversation matches this handle and agent.",
				});
			}
		});
	});
});

describe("the file workspace with inlined text", () => {
	let dir: string;
	let booted: Booted;
	let seeded: Seeded;

	beforeAll(async () => {
		dir = await mkdtemp(join(tmpdir(), "flue-files-inline-"));
		booted = await bootWithFiles("flue-files-inline", dir, {
			inlineTextBytes: 1024,
		});
		seeded = await seed(booted.payload);
	});

	afterAll(async () => {
		await shutdown(booted);
		await rm(dir, { recursive: true, force: true });
	});

	it("references each file and inlines the text files that fit", async () => {
		const form = new FormData();

		form.append(
			"file",
			new File(["# Agenda\n"], "agenda.md", { type: "text/markdown" }),
		);

		const response = await send(booted, `/api/${FILES_SLUG}`, {
			method: "POST",
			token: seeded.first.token,
			body: form,
		});
		const { doc } = (await response.json()) as { doc: Doc };

		await send(booted, "/api/flue/chat/editor", {
			method: "POST",
			token: seeded.first.token,
			body: { message: "Plan", files: [doc.id], context: CONTEXT },
		});

		const posted = JSON.parse(booted.sidecar.sends().at(-1)?.body ?? "{}") as {
			body: string;
		};
		const body = readUserTurnBody(posted.body);

		expect(body?.files).toEqual([
			{
				id: String(doc.id),
				name: "agenda.md",
				mimeType: "text/markdown",
				size: 9,
			},
		]);
		expect(body?.inline).toEqual([
			{
				type: "document",
				data: Buffer.from("# Agenda\n").toString("base64"),
				mimeType: "text/markdown",
				filename: "agenda.md",
			},
		]);
	});
});
