import { mcpxPlugin } from "@abinnovision/payloadcms-mcpx";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPayloadRequest, handleEndpoints } from "payload";
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
	login,
	mcpRpc,
	send,
	shutdown,
	stored,
	THREADS_SLUG,
} from "./helpers/payload.js";
import { contextOf, filesOf } from "../../src/agent/context.js";
import { exchangeSession, FluePayloadError } from "../../src/agent/exchange.js";
import { downloadDocument } from "../../src/agent/files.js";
import { uploadDocument } from "../../src/agent/upload.js";
import { fluePlugin, flueThreadScoped } from "../../src/index.js";
import { MANAGED_BY } from "../../src/keys/augment.js";
import { INITIAL_DATA_KEY } from "../../src/protocol/exchange.js";
import { SIDECAR_SECRET } from "../fixtures/config.js";

import type { Booted, Doc } from "./helpers/payload.js";
import type { ExchangeSession } from "../../src/agent/exchange.js";
import type { FlueAgentConfig } from "../../src/index.js";
import type { SendArgs } from "../../src/sidecar/client.js";
import type { DeliveredMessage } from "@flue/runtime";
import type {
	Access,
	CollectionBeforeOperationHook,
	CollectionConfig,
	Config,
} from "payload";

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

const UPLOADS = "uploads";
const PAYLOAD_URL = "http://localhost";
const CONTEXT = { route: "/admin" };
const MIB = 1024 * 1024;

// A valid one-pixel PNG.
const PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
	"base64",
);

// A PDF of `size` bytes with the header and trailer Payload checks.
const pdfOf = (size: number): Uint8Array<ArrayBuffer> => {
	const bytes = new Uint8Array(size).fill(0x20);
	const trailer = new TextEncoder().encode("xref\n%%EOF\n");

	bytes.set(new TextEncoder().encode("%PDF-1.4\n"));
	bytes.set(trailer, size - trailer.byteLength);

	return bytes;
};

const FILER: FlueAgentConfig = {
	slug: "filer",
	files: true,
	capabilities: {
		collections: { [UPLOADS]: { write: true }, pages: { read: true } },
	},
};

// Takes files and attaches whatever Flue takes natively.
const GREEDY: FlueAgentConfig = {
	slug: "greedy",
	files: { deliver: () => "attach" },
	capabilities: {},
};

const PLAIN: FlueAgentConfig = {
	slug: "plain",
	capabilities: { collections: { pages: { read: true } } },
};

const users: CollectionConfig = { slug: "users", auth: true, fields: [] };

const pages: CollectionConfig = {
	slug: "pages",
	fields: [{ name: "title", type: "text" }],
};

const loggedIn: Access = ({ req }) => Boolean(req.user);

// Readable by everyone, so only flueThreadScoped keeps agents to their thread.
const uploads = (staticDir: string): CollectionConfig => ({
	slug: UPLOADS,
	versions: true,
	access: {
		read: flueThreadScoped(() => true),
		create: loggedIn,
		update: flueThreadScoped(loggedIn),
		delete: flueThreadScoped(loggedIn),
	},
	upload: {
		staticDir,
		mimeTypes: ["image/png", "application/pdf", "text/plain", "text/csv"],
		pasteURL: false,
	},
	fields: [{ name: "alt", type: "text" }],
});

const filesConfig = (dir: string, sidecarUrl: string): Partial<Config> => ({
	collections: [users, pages, uploads(join(dir, "store"))],
	plugins: [
		mcpxPlugin({ collections: { [UPLOADS]: {}, pages: {} } }),
		fluePlugin({
			sidecar: { url: sidecarUrl, secret: SIDECAR_SECRET },
			agents: [FILER, GREEDY, PLAIN],
			files: { collection: UPLOADS },
		}),
	],
});

interface User {
	id: number | string;
	token: string;
}

interface Posted {
	kind: "signal" | "user";
	type?: string;
	body: string;
	attributes?: Record<string, string>;
	attachments?: { type: string; data: string; mimeType: string }[];
	initialData?: Record<string, { handle: string }>;
}

interface Chat {
	thread: number | string;
	posted: Posted;
	/** Set on a thread's first turn. */
	handle: string | undefined;
}

describe("chat files", () => {
	let dir: string;
	let booted: Booted;

	const fetchThrough: typeof fetch = async (input, init) =>
		await handleEndpoints({
			config: booted.config,
			payloadInstanceCacheKey: booted.cacheKey,
			request: new Request(input, init),
		});

	const freshUser = async (): Promise<User> => {
		const credentials = {
			email: `${randomUUID()}@example.com`,
			password: "files-secret",
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

	const upload = async (
		user: User,
		name: string,
		bytes: BlobPart,
		type: string,
		data?: Record<string, unknown>,
	): Promise<Response> => {
		const form = new FormData();

		form.append("file", new File([bytes], name, { type }));

		if (data) {
			form.append("_payload", JSON.stringify(data));
		}

		return await send(booted, `/api/${UPLOADS}`, {
			method: "POST",
			token: user.token,
			body: form,
		});
	};

	const uploaded = async (
		user: User,
		name = "notes.txt",
		bytes: BlobPart = "Some notes.\n",
		type = "text/plain",
	): Promise<Doc> => {
		const response = await upload(user, name, bytes, type);

		expect(response.status).toBe(201);

		return ((await response.json()) as { doc: Doc }).doc;
	};

	const threadOf = async (id: number | string): Promise<unknown> =>
		(
			await booted.payload.findByID({
				collection: UPLOADS,
				id,
				depth: 0,
				overrideAccess: true,
			})
		)["flueThread"] ?? null;

	const chat = (
		user: User,
		body: Record<string, unknown>,
		agent = FILER.slug,
	): Promise<Response> =>
		send(booted, `/api/flue/chat/${agent}`, {
			method: "POST",
			token: user.token,
			body: { context: CONTEXT, ...body },
		});

	const chatOk = async (
		user: User,
		body: Record<string, unknown>,
		agent = FILER.slug,
	): Promise<Chat> => {
		const response = await chat(user, body, agent);

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
			posted,
			handle: posted.initialData?.[INITIAL_DATA_KEY]?.handle,
		};
	};

	// The delivery as the agent sees it.
	const deliveryOf = (posted: Posted): DeliveredMessage =>
		(posted.kind === "user"
			? { kind: "user", body: posted.body, attachments: posted.attachments }
			: {
					kind: "signal",
					type: posted.type,
					body: posted.body,
					attributes: posted.attributes,
				}) as DeliveredMessage;

	// The agent's session for a thread's handle.
	const sessionOf = (handle: string, agent = FILER.slug): ExchangeSession =>
		exchangeSession({
			payloadUrl: PAYLOAD_URL,
			fluePath: "/api/flue",
			mcpPath: "/api/mcpx",
			secret: SIDECAR_SECRET,
			handle,
			agent,
			fetch: fetchThrough,
		});

	const targetOf = (handle: string) => ({
		session: sessionOf(handle),
		payloadUrl: PAYLOAD_URL,
		mcpPath: "/api/mcpx",
		handle,
		fetch: fetchThrough,
	});

	const idsFound = async (session: ExchangeSession): Promise<string[]> => {
		const result = (await session.callTool("findDocuments", {
			collection: UPLOADS,
			limit: 25,
		})) as { docs: Doc[] };

		return result.docs.map((doc) => String(doc.id)).sort();
	};

	beforeAll(async () => {
		dir = await mkdtemp(join(tmpdir(), "flue-files-"));
		booted = await bootPayload("flue-files", undefined, (sidecarUrl) =>
			filesConfig(dir, sidecarUrl),
		);
	});

	beforeEach(() => {
		booted.sidecar.reset();
	});

	afterAll(async () => {
		await shutdown(booted);
		await rm(dir, { recursive: true, force: true });
	});

	describe("flueThreadScoped", () => {
		let owner: User;
		let mine: Doc;
		let other: Doc;
		let unbound: Doc;
		let handle: string;
		let otherHandle: string;

		beforeAll(async () => {
			owner = await freshUser();
			mine = await uploaded(owner, "mine.txt", "Mine.\n");
			other = await uploaded(owner, "other.txt", "Other.\n");
			unbound = await uploaded(owner, "unbound.txt", "Unbound.\n");
			handle = (await chatOk(owner, { message: "A", files: [mine.id] }))
				.handle!;
			otherHandle = (await chatOk(owner, { message: "B", files: [other.id] }))
				.handle!;
		});

		it("lets the agent read its thread's file and find only its thread's files", async () => {
			const session = sessionOf(handle);

			await expect(
				session.callTool("getDocument", { collection: UPLOADS, id: mine.id }),
			).resolves.toMatchObject({ id: mine.id });
			expect(await idsFound(session)).toEqual([String(mine.id)]);
			expect(await idsFound(sessionOf(otherHandle))).toEqual([
				String(other.id),
			]);
		});

		it("refuses another thread's file and an unbound one on getDocument and download", async () => {
			const target = targetOf(handle);

			for (const doc of [other, unbound]) {
				// eslint-disable-next-line no-await-in-loop
				await expect(
					target.session.callTool("getDocument", {
						collection: UPLOADS,
						id: doc.id,
					}),
				).rejects.toBeInstanceOf(FluePayloadError);
				// eslint-disable-next-line no-await-in-loop
				await expect(
					downloadDocument(target, { collection: UPLOADS, id: doc.id }),
				).rejects.toBeInstanceOf(FluePayloadError);
			}
		});

		it("downloads the thread's file and a range of it", async () => {
			const target = targetOf(handle);

			expect(
				new TextDecoder().decode(
					(await downloadDocument(target, { collection: UPLOADS, id: mine.id }))
						.bytes,
				),
			).toBe("Mine.\n");
			expect(
				new TextDecoder().decode(
					(
						await downloadDocument(target, {
							collection: UPLOADS,
							id: mine.id,
							range: { start: 1, end: 3 },
						})
					).bytes,
				),
			).toBe("ine");
		});

		it("refuses every file to the managed key without the handle header", async () => {
			const { key } = await sessionOf(handle).exchange();
			const { body } = await mcpRpc(booted, key, "tools/call", {
				name: "findDocuments",
				arguments: { collection: UPLOADS },
			});

			expect(body).toMatchObject({ result: { isError: true } });
		});

		it("refuses a headerless fetch of a valid download grant", async () => {
			const doc = (await sessionOf(handle).callTool("getDocument", {
				collection: UPLOADS,
				id: mine.id,
				download: true,
			})) as { download: { headers: Record<string, string> } };
			const response = await fetchThrough(`${PAYLOAD_URL}/api/mcpx/file`, {
				headers: doc.download.headers,
			});

			expect(response.status).toBe(403);
		});

		it("refuses the handle of an archived thread", async () => {
			const user = await freshUser();
			const doc = await uploaded(user);
			const { thread, handle: archivedHandle } = await chatOk(user, {
				message: "Read",
				files: [doc.id],
			});
			const session = sessionOf(archivedHandle!);

			// Exchanged while live; the key stays valid after the archive.
			await session.exchange();

			const archived = await send(
				booted,
				`/api/${THREADS_SLUG}/${String(thread)}`,
				{ method: "PATCH", token: user.token, body: { status: "archived" } },
			);

			expect(archived.status).toBe(200);
			await expect(
				session.callTool("getDocument", { collection: UPLOADS, id: doc.id }),
			).rejects.toBeInstanceOf(FluePayloadError);
			// Archiving leaves the file bound.
			expect(String(await threadOf(doc.id))).toBe(String(thread));
		});

		it("leaves a key flue does not manage alone", async () => {
			const created = await booted.payload.create({
				collection: API_KEYS_SLUG,
				data: {
					label: "Own key",
					user: owner.id,
					enabled: true,
					capabilities: { collections: { [UPLOADS]: { read: true } } },
				},
				overrideAccess: true,
			});
			const { apiKey } = await booted.payload.findByID({
				collection: API_KEYS_SLUG,
				id: created.id,
				depth: 0,
				overrideAccess: true,
				showHiddenFields: true,
			});
			const { body } = await mcpRpc(booted, String(apiKey), "tools/call", {
				name: "findDocuments",
				arguments: { collection: UPLOADS, limit: 25 },
			});
			const result = body["result"] as {
				content: { text: string }[];
			};
			const found = (JSON.parse(result.content[0]!.text) as { docs: Doc[] })
				.docs;

			expect(found.map((doc) => String(doc.id))).toEqual(
				expect.arrayContaining([
					String(mine.id),
					String(other.id),
					String(unbound.id),
				]),
			);
		});

		it("leaves the admin's REST reads alone", async () => {
			const response = await send(booted, `/api/${UPLOADS}?limit=100`, {
				token: owner.token,
			});
			const { docs } = (await response.json()) as { docs: Doc[] };

			expect(docs.map((doc) => String(doc.id))).toEqual(
				expect.arrayContaining([String(mine.id), String(other.id)]),
			);
		});

		// A request as the owner's managed key, the way mcpx makes one, with `headers`.
		const agentRequest = async (headers: Record<string, string>) => {
			const apiKey = (
				await booted.payload.find({
					collection: API_KEYS_SLUG,
					where: {
						and: [
							{ user: { equals: owner.id } },
							{ [MANAGED_BY]: { equals: `flue:${FILER.slug}` } },
						],
					},
					overrideAccess: true,
					limit: 1,
				})
			).docs[0]!;
			const user = await booted.payload.findByID({
				collection: "users",
				id: owner.id,
				overrideAccess: true,
			});

			return await createPayloadRequest({
				payload: booted.payload,
				user: { ...user, collection: "users" },
				context: {
					mcpx: {
						apiKeyId: apiKey.id,
						capabilities: { collections: {}, globals: {}, tools: {} },
					},
				},
				req: { headers: new Headers(headers) },
			});
		};

		it("narrows versions to the thread's files", async () => {
			const versions = async (headers: Record<string, string>) =>
				(
					await booted.payload.findVersions({
						collection: UPLOADS,
						limit: 100,
						overrideAccess: false,
						req: await agentRequest(headers),
					})
				).docs.map((doc) => String(doc.parent));

			const scoped = await versions({ "x-flue-handle": handle });

			expect(scoped.length).toBeGreaterThan(0);
			expect(new Set(scoped)).toEqual(new Set([String(mine.id)]));
			await expect(versions({})).rejects.toThrow(/not allowed/);
		});

		it("lets the agent patch its thread's file and no other", async () => {
			const session = sessionOf(handle);
			const patch = (id: number | string) =>
				session.callTool("patchDocument", {
					collection: UPLOADS,
					id,
					patches: [{ op: "replace", path: "/alt", value: "Patched" }],
				});

			await expect(patch(mine.id)).resolves.toBeDefined();
			await expect(patch(other.id)).rejects.toBeInstanceOf(FluePayloadError);
			expect(
				(
					await booted.payload.findByID({
						collection: UPLOADS,
						id: other.id,
						overrideAccess: true,
					})
				)["alt"],
			).not.toBe("Patched");
		});

		it("refuses the agent's update and delete of another thread's file", async () => {
			const headers = { "x-flue-handle": handle };

			await expect(
				booted.payload.update({
					collection: UPLOADS,
					id: other.id,
					data: { alt: "Changed" },
					overrideAccess: false,
					req: await agentRequest(headers),
				}),
			).rejects.toThrow();
			await expect(
				booted.payload.delete({
					collection: UPLOADS,
					id: other.id,
					overrideAccess: false,
					req: await agentRequest(headers),
				}),
			).rejects.toThrow();
			expect(
				await booted.payload.findByID({
					collection: UPLOADS,
					id: other.id,
					overrideAccess: true,
				}),
			).toMatchObject({ id: other.id });
		});
	});

	describe("binding at send", () => {
		it("refuses another user's readable file and sends nothing", async () => {
			const [user, stranger] = [await freshUser(), await freshUser()];
			const doc = await uploaded(stranger);
			const sends = booted.sidecar.sends().length;

			expect(
				(await chat(user, { message: "Hi", files: [doc.id] })).status,
			).toBe(404);
			expect(booted.sidecar.sends()).toHaveLength(sends);
			expect(await threadOf(doc.id)).toBeNull();
		});

		it("refuses a file bound to another thread and keeps it there", async () => {
			const user = await freshUser();
			const doc = await uploaded(user);
			const { thread } = await chatOk(user, {
				message: "One",
				files: [doc.id],
			});

			expect(
				(await chat(user, { message: "Two", files: [doc.id] })).status,
			).toBe(404);
			expect(String(await threadOf(doc.id))).toBe(String(thread));
		});

		it("sends a file again in its own thread", async () => {
			const user = await freshUser();
			const doc = await uploaded(user);
			const { thread } = await chatOk(user, {
				message: "One",
				files: [doc.id],
			});
			const again = await chatOk(user, {
				message: "Again",
				thread,
				files: [doc.id],
			});

			expect(filesOf(deliveryOf(again.posted)).map((file) => file.id)).toEqual([
				String(doc.id),
			]);
		});

		it("strips a flueThread the client sets on create and update", async () => {
			const user = await freshUser();
			const target = await uploaded(user);
			const { thread } = await chatOk(user, {
				message: "Hi",
				files: [target.id],
			});
			const created = await upload(user, "x.txt", "x", "text/plain", {
				flueThread: thread,
			});
			const { doc } = (await created.json()) as { doc: Doc };
			const updated = await send(booted, `/api/${UPLOADS}/${String(doc.id)}`, {
				method: "PATCH",
				token: user.token,
				body: { flueThread: thread },
			});

			expect(created.status).toBe(201);
			expect(updated.status).toBe(200);
			expect(await threadOf(doc.id)).toBeNull();
		});

		it("refuses files for an agent that takes none", async () => {
			const user = await freshUser();
			const doc = await uploaded(user);

			expect(
				(await chat(user, { message: "Hi", files: [doc.id] }, PLAIN.slug))
					.status,
			).toBe(400);
		});

		it("unbinds the files of a first turn the sidecar refuses", async () => {
			const user = await freshUser();
			const doc = await uploaded(user);

			booted.sidecar.sendStatus = 400;

			expect(
				(await chat(user, { message: "Hi", files: [doc.id] })).status,
			).toBe(502);
			expect(await threadOf(doc.id)).toBeNull();
		});

		it("titles a new thread after its first file when the message is empty", async () => {
			const user = await freshUser();
			const doc = await uploaded(user, "minutes.txt");
			const { thread } = await chatOk(user, { message: "", files: [doc.id] });

			expect((await stored(booted, thread))["title"]).toBe("minutes.txt");
		});
	});

	describe("agent uploads", () => {
		it("creates a file in the thread-scoped collection, unbound and unreadable to the agent", async () => {
			const user = await freshUser();
			const { handle } = await chatOk(user, { message: "Write" });
			const target = targetOf(handle!);
			const created = await uploadDocument(target, {
				collection: UPLOADS,
				filename: "summary.txt",
				mimeType: "text/plain",
				data: "Summary.\n",
			});

			expect(await threadOf(created.id)).toBeNull();
			await expect(
				downloadDocument(target, { collection: UPLOADS, id: created.id }),
			).rejects.toBeInstanceOf(FluePayloadError);
		});
	});

	describe("delivery", () => {
		it("sends a turn without attachments as a signal whose body is the typed text", async () => {
			const user = await freshUser();
			const doc = await uploaded(user, "data.csv", "a,b\n1,2\n", "text/csv");
			const { posted } = await chatOk(user, {
				message: "Sum <this>",
				files: [doc.id],
			});

			expect(posted).toMatchObject({
				kind: "signal",
				type: "payload-context",
				body: "Sum <this>",
			});
			expect(filesOf(deliveryOf(posted))).toEqual([
				{
					collection: UPLOADS,
					id: String(doc.id),
					name: "data.csv",
					mimeType: "text/csv",
					size: 8,
					attached: false,
				},
			]);
		});

		it("attaches an image to a user message and lists it in the preamble", async () => {
			const user = await freshUser();
			const image = await uploaded(user, "dot.png", PNG, "image/png");
			const csv = await uploaded(user, "data.csv", "a,b\n", "text/csv");
			const { posted } = await chatOk(user, {
				message: "Describe",
				files: [image.id, csv.id],
			});
			const delivery = deliveryOf(posted);

			expect(posted.kind).toBe("user");
			// Flue may admit a large body after its default 10 seconds.
			expect(sends.at(-1)?.timeoutMs).toBe(60_000);
			expect(posted.attachments).toEqual([
				{
					type: "image",
					data: PNG.toString("base64"),
					mimeType: "image/png",
					filename: "dot.png",
				},
			]);
			expect(contextOf(delivery)).toMatchObject({ route: "/admin" });
			expect(
				filesOf(delivery).map(({ id, attached }) => ({ id, attached })),
			).toEqual([
				{ id: String(image.id), attached: true },
				{ id: String(csv.id), attached: false },
			]);
		});

		it("references a CSV even when the agent's policy attaches it", async () => {
			const user = await freshUser();
			const csv = await uploaded(user, "data.csv", "a,b\n", "text/csv");
			const { posted } = await chatOk(
				user,
				{ message: "Read", files: [csv.id] },
				GREEDY.slug,
			);

			expect(posted.kind).toBe("signal");
			expect(filesOf(deliveryOf(posted))).toMatchObject([{ attached: false }]);
		});

		it("references what passes the per-turn attachment budget", async () => {
			const user = await freshUser();
			const docs = await Promise.all(
				[1, 2, 3, 4, 5].map((index) =>
					uploaded(
						user,
						`part-${String(index)}.pdf`,
						pdfOf(4 * MIB),
						"application/pdf",
					),
				),
			);

			const { posted } = await chatOk(
				user,
				{ message: "Read", files: docs.map((doc) => doc.id) },
				GREEDY.slug,
			);

			expect(posted.attachments).toHaveLength(4);
			expect(filesOf(deliveryOf(posted)).map((file) => file.attached)).toEqual([
				true,
				true,
				true,
				true,
				false,
			]);
		});
	});

	describe("the agents endpoint", () => {
		it("answers each agent's file limits, null for an agent without files", async () => {
			const user = await freshUser();
			const response = await send(booted, "/api/flue/agents", {
				token: user.token,
			});
			const { agents } = (await response.json()) as {
				agents: { slug: string; files: unknown }[];
			};
			const limits = {
				collection: UPLOADS,
				mimeTypes: ["image/png", "application/pdf", "text/plain", "text/csv"],
				maxFiles: 10,
			};

			expect(agents).toEqual([
				expect.objectContaining({ slug: FILER.slug, files: limits }),
				expect.objectContaining({ slug: GREEDY.slug, files: limits }),
				expect.objectContaining({ slug: PLAIN.slug, files: null }),
			]);
		});
	});
});

const ownFiles: Access = ({ req }) =>
	req.user?.collection === "users"
		? {
				and: [
					{ "createdBy.relationTo": { equals: "users" } },
					{ "createdBy.value": { equals: req.user.id } },
				],
			}
		: false;

// Stores each file under a random name and keeps the uploader's in `name`.
const randomName: CollectionBeforeOperationHook = (hook) => {
	const { req } = hook;

	// eslint-disable-next-line @typescript-eslint/no-deprecated
	if (hook.operation !== "create" || !req.file) {
		return hook.args;
	}

	const { name } = req.file;
	const extension = /\.[A-Za-z0-9]{1,8}$/.exec(name)?.[0].toLowerCase() ?? "";

	req.file = { ...req.file, name: `${randomUUID()}${extension}` };

	return {
		...hook.args,
		data: { ...hook.args.data, name: name.slice(0, 255) },
	};
};

// The private uploads collection of docs/recipes.md, without flueThreadScoped.
const privateUploads = (staticDir: string): CollectionConfig => ({
	slug: UPLOADS,
	authorship: true,
	versions: false,
	admin: {
		hidden: true,
		useAsTitle: "name",
		enableRichTextRelationship: false,
	},
	upload: { staticDir, mimeTypes: ["text/csv"], pasteURL: false },
	access: {
		read: ownFiles,
		create: ({ req }) => req.user?.collection === "users",
		update: () => false,
		delete: ownFiles,
	},
	hooks: { beforeOperation: [randomName] },
	fields: [
		{
			name: "name",
			type: "text",
			maxLength: 255,
			admin: { readOnly: true },
			access: { update: () => false },
		},
	],
});

describe("chat files in a private uploads collection", () => {
	let dir: string;
	let booted: Booted;

	const userOf = async (): Promise<User> => {
		const credentials = {
			email: `${randomUUID()}@example.com`,
			password: "private-secret",
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

	const uploadAs = async (user: User, name: string): Promise<Doc> => {
		const form = new FormData();

		form.append("file", new File(["a,b\n"], name, { type: "text/csv" }));

		const response = await send(booted, `/api/${UPLOADS}`, {
			method: "POST",
			token: user.token,
			body: form,
		});

		expect(response.status).toBe(201);

		return ((await response.json()) as { doc: Doc }).doc;
	};

	const chatAs = async (
		user: User,
		body: Record<string, unknown>,
	): Promise<{ response: Response; posted: Posted }> => {
		const response = await send(booted, `/api/flue/chat/${FILER.slug}`, {
			method: "POST",
			token: user.token,
			body: { context: CONTEXT, ...body },
		});
		const posted = JSON.parse(
			booted.sidecar.sends().at(-1)?.body ?? "{}",
		) as Posted;

		return { response, posted };
	};

	beforeAll(async () => {
		dir = await mkdtemp(join(tmpdir(), "flue-private-"));
		booted = await bootPayload("flue-private-uploads", undefined, (url) => ({
			...filesConfig(dir, url),
			collections: [users, pages, privateUploads(join(dir, "private"))],
		}));
	});

	beforeEach(() => {
		booted.sidecar.reset();
	});

	afterAll(async () => {
		await shutdown(booted);
		await rm(dir, { recursive: true, force: true });
	});

	it("stores a file under a random name, keeps the uploader's, and shows it to the uploader only", async () => {
		const [owner, stranger] = [await userOf(), await userOf()];
		const doc = await uploadAs(owner, "q3 numbers.csv");
		const read = (user: User) =>
			send(booted, `/api/${UPLOADS}/${String(doc.id)}`, { token: user.token });

		expect(doc["name"]).toBe("q3 numbers.csv");
		expect(doc["filename"]).toMatch(/^[0-9a-f-]{36}\.csv$/);
		expect((await read(owner)).status).toBe(200);
		expect((await read(stranger)).status).toBe(404);
	});

	it("sends the uploader's name with the turn", async () => {
		const owner = await userOf();
		const doc = await uploadAs(owner, "q3 numbers.csv");
		const { response, posted } = await chatAs(owner, {
			message: "Sum",
			files: [doc.id],
		});

		expect(response.status).toBe(200);
		expect(filesOf(posted as DeliveredMessage)).toMatchObject([
			{ id: String(doc.id), name: "q3 numbers.csv", mimeType: "text/csv" },
		]);
	});

	it("lets the agent read the user's files across threads but no other user's", async () => {
		const [owner, stranger] = [await userOf(), await userOf()];
		const first = await uploadAs(owner, "first.csv");
		const second = await uploadAs(owner, "second.csv");
		const foreign = await uploadAs(stranger, "foreign.csv");
		const { posted } = await chatAs(owner, {
			message: "A",
			files: [first.id],
		});

		await chatAs(owner, { message: "B", files: [second.id] });

		const session = exchangeSession({
			payloadUrl: PAYLOAD_URL,
			fluePath: "/api/flue",
			mcpPath: "/api/mcpx",
			secret: SIDECAR_SECRET,
			handle: posted.initialData![INITIAL_DATA_KEY]!.handle,
			agent: FILER.slug,
			fetch: async (input, init) =>
				await handleEndpoints({
					config: booted.config,
					payloadInstanceCacheKey: booted.cacheKey,
					request: new Request(input, init),
				}),
		});
		const { docs } = (await session.callTool("findDocuments", {
			collection: UPLOADS,
			limit: 25,
		})) as { docs: Doc[] };

		expect(docs.map((doc) => String(doc.id)).sort()).toEqual(
			[String(first.id), String(second.id)].sort(),
		);
		await expect(
			session.callTool("getDocument", { collection: UPLOADS, id: foreign.id }),
		).rejects.toBeInstanceOf(FluePayloadError);
	});
});
