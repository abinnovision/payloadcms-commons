import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
	collectionEnumOf,
	createMcpClient,
	endpointGet,
	uploadPut,
} from "./helpers/mcp.js";
import {
	API_KEYS_SLUG,
	bootPayload,
	createKey,
	createMedia,
	PIXEL,
	seedKeysFor,
	storedState,
} from "./helpers/payload.js";
import { hashApiKey } from "../../src/api-keys/key.js";
import { MEDIA_DIR } from "../fixtures/collections.js";

import type { McpClient } from "./helpers/mcp.js";
import type { Booted, KeyCapabilities } from "./helpers/payload.js";
import type { CollectionConfig, Payload } from "payload";

const CACHE_KEY = "mcpx-uploads";

const FILES_DIR = join(tmpdir(), "mcpx-fixture-files");

const ATTACHMENTS_DIR = join(tmpdir(), "mcpx-fixture-attachments");

/*
 * An upload collection without drafts: every write is live. Its users read
 * every document except those with the alt "Hidden".
 */
const files: CollectionConfig = {
	slug: "files",
	access: {
		read: ({ req }) => (req.user ? { alt: { not_equals: "Hidden" } } : false),
	},
	upload: { staticDir: FILES_DIR, mimeTypes: ["image/*"] },
	fields: [{ name: "alt", type: "text", required: true }],
};

/*
 * An upload collection without `mimeTypes`, which MCP takes no files for, and
 * with a `download` field, which MCP offers no download for.
 */
const attachments: CollectionConfig = {
	slug: "attachments",
	upload: { staticDir: ATTACHMENTS_DIR },
	fields: [
		{ name: "note", type: "text" },
		{ name: "download", type: "text" },
	],
};

const CAPABILITIES: KeyCapabilities = {
	collections: {
		pages: { read: true, write: true },
		media: { read: true, write: true, publish: true },
		files: { read: true, write: true },
		attachments: { read: true, write: true },
	},
};

const PDF = Buffer.from("%PDF-1.7\n%%EOF\n");

interface Upload {
	url: string;
	method: string;
	headers: Record<string, string>;
	expiresAt: string;
	maxBytes: number;
}

type Doc = Record<string, unknown> & { id: number | string };

const fileOf = (filename = "pixel.png", body: Buffer = PIXEL) => ({
	filename,
	mimeType: "image/png",
	size: body.length,
});

// The grants waiting in Payload's KV.
const grantsIn = async (payload: Payload): Promise<number> => {
	const { docs } = await payload.find({
		collection: "payload-kv" as never,
		pagination: false,
		overrideAccess: true,
	});

	return docs.filter((doc) =>
		String((doc as { key?: unknown }).key).startsWith("mcpx-grant:"),
	).length;
};

describe("uploads through MCP", () => {
	let booted: Booted;
	let userId: number | string;
	let mcp: McpClient;

	beforeAll(async () => {
		booted = await bootPayload({
			key: CACHE_KEY,
			collections: [files, attachments],
			plugin: {
				collections: {
					pages: { publish: false },
					media: true,
					files: true,
					attachments: true,
				},
			},
		});

		const seeded = await seedKeysFor(booted.payload, { editor: CAPABILITIES });

		userId = seeded.userId;
		mcp = createMcpClient(booted, seeded.keys.editor);
	});

	afterAll(async () => {
		await booted.payload.destroy();

		await Promise.all(
			[MEDIA_DIR, FILES_DIR, ATTACHMENTS_DIR].map((dir) =>
				rm(dir, { recursive: true, force: true }),
			),
		);
	});

	const readDoc = (
		collection: string,
		id: number | string,
		options: { draft?: boolean; locale?: string } = {},
	) =>
		booted.payload.findByID({
			collection: collection as never,
			id,
			depth: 0,
			draft: options.draft ?? true,
			locale: options.locale ?? "en",
			fallbackLocale: false,
			overrideAccess: true,
		}) as unknown as Promise<Doc>;

	const filesOnDisk = async (dir: string): Promise<string[]> =>
		existsSync(dir) ? (await readdir(dir)).sort() : [];

	const createFile = async (alt: string): Promise<Doc> =>
		await booted.payload.create({
			collection: "files" as never,
			data: { alt },
			file: {
				data: PIXEL,
				mimetype: "image/png",
				name: "pixel.png",
				size: PIXEL.length,
			},
			overrideAccess: true,
		});

	const publishMedia = async (alt: string): Promise<Doc> => {
		const { id } = await createMedia(booted.payload, alt);

		await booted.payload.update({
			collection: "media" as never,
			id,
			data: { _status: "published" },
			overrideAccess: true,
		});

		return await readDoc("media", id);
	};

	// Issues a grant through the tool call, failing the test if none comes back.
	const issue = async (
		tool: string,
		args: Record<string, unknown>,
		client: McpClient = mcp,
	): Promise<Upload> => {
		const result = await client.call(tool, args);

		expect(result.text).toContain('"upload"');

		return result.data["upload"] as Upload;
	};

	const send = async (
		upload: Upload,
		options: {
			body?: Buffer;
			headers?: Record<string, string>;
			url?: string;
		} = {},
	) => {
		const body = options.body ?? PIXEL;
		const response = await uploadPut(booted, {
			url: options.url ?? upload.url,
			headers: {
				...upload.headers,
				"content-length": String(body.length),
				...options.headers,
			},
			body,
		});

		return {
			status: response.status,
			data: (await response.json()) as Record<string, unknown>,
		};
	};

	const snapshot = async () => ({
		state: await storedState(booted.payload, {
			collections: ["media", "files"],
		}),
		media: await filesOnDisk(MEDIA_DIR),
		files: await filesOnDisk(FILES_DIR),
	});

	describe("the tool surface", () => {
		it("describes only the fields the collection declares itself", async () => {
			const result = await mcp.call("describeSchema", { collection: "media" });
			const [root] = result.data as unknown as {
				fields: { path: string }[];
			}[];

			expect(root?.fields.map((field) => field.path)).toEqual([
				"/alt",
				"/credit",
			]);
		});

		it("reports create only where MCP accepts the files", async () => {
			const result = await mcp.call("listCapabilities", {});
			const collections = result.data["collections"] as Record<
				string,
				unknown
			>[];

			expect(collections).toEqual([
				expect.objectContaining({ slug: "pages", create: true }),
				expect.objectContaining({ slug: "media", create: true }),
				expect.objectContaining({ slug: "files", create: true }),
				expect.objectContaining({
					slug: "attachments",
					write: true,
					create: false,
				}),
			]);
		});

		it("leaves a collection without mimeTypes out of createDocument", async () => {
			const tools = await mcp.list();
			const find = (name: string) => tools.find((tool) => tool.name === name);

			expect(collectionEnumOf(find("createDocument"))).toEqual([
				"pages",
				"media",
				"files",
			]);
			expect(collectionEnumOf(find("patchDocument"))).toContain("attachments");
			expect(find("createDocument")?.description).toContain(
				"Documents in attachments are files and cannot be created here.",
			);
		});

		it("patches a field and leaves the file untouched", async () => {
			const { id } = await createMedia(booted.payload, "Original");
			const before = await readDoc("media", id);

			const result = await mcp.call("patchDocument", {
				collection: "media",
				id,
				locale: "en",
				patches: [{ op: "replace", path: "/alt", value: "Patched" }],
			});

			expect(result.isError).toBe(false);

			const after = await readDoc("media", id);

			expect(after["alt"]).toBe("Patched");
			expect(after["filename"]).toBe(before["filename"]);
			expect(after["filesize"]).toBe(before["filesize"]);
		});

		/*
		 * `focalX` is the one upload base field Payload leaves writable, so this
		 * fails the moment the schema walk stops treating `admin.hidden` as hidden.
		 */
		it("refuses a patch aimed at an upload base field", async () => {
			const { id } = await createMedia(booted.payload, "Focal");
			const result = await mcp.call("patchDocument", {
				collection: "media",
				id,
				locale: "en",
				patches: [{ op: "replace", path: "/focalX", value: 10 }],
			});

			expect(result.isError).toBe(true);
			expect(JSON.stringify(result.data["problems"])).toContain("/focalX");
			expect((await readDoc("media", id))["focalX"]).not.toBe(10);
		});
	});

	describe("writes", () => {
		it("writes nothing until the file arrives, then creates a draft with the seed", async () => {
			const before = await snapshot();
			const upload = await issue("createDocument", {
				collection: "media",
				locale: "en",
				data: { alt: "Fresh" },
				file: fileOf("fresh.png"),
			});

			expect(upload).toMatchObject({
				url: "http://localhost/api/mcpx/upload",
				method: "PUT",
				headers: { "content-type": "image/png" },
				maxBytes: 25 * 1024 * 1024,
			});
			expect(await snapshot()).toEqual(before);

			const { status, data } = await send(upload);

			expect(status).toBe(200);
			expect(data).toMatchObject({ status: "draft" });
			expect(await readDoc("media", data["id"] as number)).toMatchObject({
				_status: "draft",
				alt: "Fresh",
				filename: "fresh.png",
				mimeType: "image/png",
				filesize: PIXEL.length,
			});
		});

		it("applies patches and the file in one version", async () => {
			const { id } = await createMedia(booted.payload, "Before");
			const versions = async () =>
				(
					await booted.payload.findVersions({
						collection: "media" as never,
						where: { parent: { equals: id } },
						overrideAccess: true,
					})
				).totalDocs;
			const count = await versions();

			const { status } = await send(
				await issue("patchDocument", {
					collection: "media",
					id,
					locale: "en",
					patches: [{ op: "replace", path: "/alt", value: "After" }],
					file: fileOf("together.png"),
				}),
			);

			expect(status).toBe(200);
			expect(await versions()).toBe(count + 1);
			expect(await readDoc("media", id)).toMatchObject({
				alt: "After",
				filename: "together.png",
			});
		});

		it("replaces only the file when patches is empty", async () => {
			const { id } = await createMedia(booted.payload, "Kept");
			const { status } = await send(
				await issue("patchDocument", {
					collection: "media",
					id,
					locale: "en",
					patches: [],
					file: fileOf("only-file.png"),
				}),
			);

			expect(status).toBe(200);
			expect(await readDoc("media", id)).toMatchObject({
				alt: "Kept",
				filename: "only-file.png",
			});
		});

		it("refuses an empty patches without a file", async () => {
			const { id } = await createMedia(booted.payload, "Empty");
			const result = await mcp.call("patchDocument", {
				collection: "media",
				id,
				locale: "en",
				patches: [],
			});

			expect(result.isError).toBe(true);
			expect(result.data["error"]).toBe(
				'"patches" may be empty only when "file" is given.',
			);
		});

		it("keeps the id and deletes the old file when replacing without drafts", async () => {
			const doc = await createFile("Live");
			const old = doc["filename"] as string;
			const { status, data } = await send(
				await issue("patchDocument", {
					collection: "files",
					id: doc.id,
					locale: "en",
					patches: [],
					file: fileOf("live-next.png"),
				}),
			);

			expect(status).toBe(200);
			expect(data["id"]).toBe(doc.id);
			expect((await readDoc("files", doc.id))["filename"]).toBe(
				"live-next.png",
			);
			expect(existsSync(join(FILES_DIR, old))).toBe(false);
		});

		it("keeps the published file until the draft with the new one is published", async () => {
			const doc = await publishMedia("Published");
			const old = doc["filename"] as string;
			const { status } = await send(
				await issue("patchDocument", {
					collection: "media",
					id: doc.id,
					locale: "en",
					patches: [],
					file: fileOf("next-draft.png"),
				}),
			);

			expect(status).toBe(200);
			expect(
				(await readDoc("media", doc.id, { draft: false }))["filename"],
			).toBe(old);
			expect(existsSync(join(MEDIA_DIR, old))).toBe(true);

			const published = await mcp.call("publishDocument", {
				collection: "media",
				id: doc.id,
			});

			expect(published.isError).toBe(false);
			expect(
				(await readDoc("media", doc.id, { draft: false }))["filename"],
			).toBe("next-draft.png");
		});

		it("preserves a non-default locale", async () => {
			const { status, data } = await send(
				await issue("createDocument", {
					collection: "media",
					locale: "de",
					data: { alt: "Neu" },
					file: fileOf("locale.png"),
				}),
			);

			expect(status).toBe(200);
			expect(
				(await readDoc("media", data["id"] as number, { locale: "de" }))["alt"],
			).toBe("Neu");
			expect((await readDoc("media", data["id"] as number))["alt"]).toBeFalsy();
		});

		it("ignores ?locale and ?uploadEdits on the upload URL", async () => {
			const upload = await issue("createDocument", {
				collection: "media",
				locale: "en",
				data: { alt: "Steered" },
				file: fileOf("steered.png"),
			});
			const { status, data } = await send(upload, {
				url: `${upload.url}?locale=de&uploadEdits[focalPoint][x]=10&uploadEdits[focalPoint][y]=10`,
			});

			expect(status).toBe(200);

			const doc = await readDoc("media", data["id"] as number);

			expect(doc["alt"]).toBe("Steered");
			expect(doc["focalX"]).not.toBe(10);
		});
	});

	describe("refusals at the tool call", () => {
		it("refuses to replace the file under a draft that still uses the published one", async () => {
			const doc = await publishMedia("Guarded");
			const edited = await mcp.call("patchDocument", {
				collection: "media",
				id: doc.id,
				locale: "en",
				patches: [{ op: "replace", path: "/alt", value: "Draft alt" }],
			});

			expect(edited.isError).toBe(false);

			const grants = await grantsIn(booted.payload);
			const result = await mcp.call("patchDocument", {
				collection: "media",
				id: doc.id,
				locale: "en",
				patches: [],
				file: fileOf("guarded.png"),
			});

			expect(result.isError).toBe(true);
			expect(result.text).toContain("Publish or discard the draft first.");
			expect(await grantsIn(booted.payload)).toBe(grants);
			expect(existsSync(join(MEDIA_DIR, doc["filename"] as string))).toBe(true);
		});

		it("refuses a live replace whose patches fail validation", async () => {
			const doc = await createFile("Valid");
			const before = await snapshot();
			const grants = await grantsIn(booted.payload);
			const result = await mcp.call("patchDocument", {
				collection: "files",
				id: doc.id,
				locale: "en",
				patches: [{ op: "replace", path: "/alt", value: null }],
				file: fileOf("invalid.png"),
			});

			expect(result.isError).toBe(true);
			expect(result.data["validationErrors"]).toEqual([
				expect.objectContaining({ path: "/alt" }),
			]);
			expect(await grantsIn(booted.payload)).toBe(grants);
			expect(await snapshot()).toEqual(before);
		});

		it.each([
			[
				"a collection that is not an upload collection",
				{ collection: "pages", data: { title: "T", slug: "t" } },
				"does not accept files",
			],
			[
				"a type outside upload.mimeTypes",
				{
					collection: "media",
					data: { alt: "Pdf" },
					file: { filename: "doc.pdf", mimeType: "application/pdf", size: 9 },
				},
				"accepts only image/*, not",
			],
			[
				"a size over the limit",
				{
					collection: "media",
					data: { alt: "Big" },
					file: { ...fileOf(), size: 25 * 1024 * 1024 + 1 },
				},
				"size",
			],
			[
				"a filename with a path",
				{
					collection: "media",
					data: { alt: "Path" },
					file: fileOf("../escape.png"),
				},
				"filename",
			],
		])("refuses %s", async (_label, args, message) => {
			const before = await snapshot();
			const grants = await grantsIn(booted.payload);
			const result = await mcp.call("createDocument", {
				locale: "en",
				file: fileOf(),
				...args,
			});

			expect(result.isError).toBe(true);
			expect(result.text).toContain(message);
			expect(await grantsIn(booted.payload)).toBe(grants);
			expect(await snapshot()).toEqual(before);
		});

		it("refuses a file for a collection without mimeTypes", async () => {
			const doc = await booted.payload.create({
				collection: "attachments" as never,
				data: { note: "n" },
				file: {
					data: PIXEL,
					mimetype: "image/png",
					name: "pixel.png",
					size: PIXEL.length,
				},
				overrideAccess: true,
			});
			const grants = await grantsIn(booted.payload);
			const result = await mcp.call("patchDocument", {
				collection: "attachments",
				id: doc.id,
				locale: "en",
				patches: [],
				file: fileOf(),
			});

			expect(result.isError).toBe(true);
			expect(result.data["error"]).toContain(
				'"attachments" does not accept files through MCP',
			);
			expect(await grantsIn(booted.payload)).toBe(grants);
		});
	});

	describe("refusals at the PUT", () => {
		const createArgs = (alt: string) => ({
			collection: "media",
			locale: "en",
			data: { alt },
			file: fileOf(`${alt.toLowerCase()}.png`),
		});

		it("stores the grant under the HMAC of its id, never the id itself", async () => {
			const upload = await issue("createDocument", createArgs("Hashed"));
			const grantId = upload.headers["x-mcpx-grant"]!;
			const { docs } = await booted.payload.find({
				collection: "payload-kv" as never,
				pagination: false,
				overrideAccess: true,
			});
			const keys = docs.map((doc) => String((doc as { key?: unknown }).key));

			expect(
				keys.filter((key) =>
					key.endsWith(`:${hashApiKey(booted.payload.secret, grantId)}`),
				),
			).toHaveLength(1);
			expect(JSON.stringify(docs)).not.toContain(grantId);
		});

		it("refuses an unknown grant", async () => {
			const before = await snapshot();
			const upload = await issue("createDocument", createArgs("Unknown"));
			const { status } = await send(upload, {
				headers: { "x-mcpx-grant": randomBytes(32).toString("base64url") },
			});

			expect(status).toBe(403);
			expect(await snapshot()).toEqual(before);
		});

		it("refuses a grant used before", async () => {
			const upload = await issue("createDocument", createArgs("Twice"));

			expect((await send(upload)).status).toBe(200);

			const before = await snapshot();

			expect((await send(upload)).status).toBe(403);
			expect(await snapshot()).toEqual(before);
		});

		it("lets only one of two concurrent PUTs through", async () => {
			const upload = await issue("createDocument", createArgs("Race"));
			const statuses = (await Promise.all([send(upload), send(upload)])).map(
				(response) => response.status,
			);

			expect(statuses.sort()).toEqual([200, 403]);

			const { totalDocs } = await booted.payload.find({
				collection: "media" as never,
				where: { alt: { equals: "Race" } },
				draft: true,
				locale: "en",
				overrideAccess: true,
			});

			expect(totalDocs).toBe(1);
		});

		it("refuses an expired grant", async () => {
			const before = await snapshot();
			const upload = await issue("createDocument", createArgs("Late"));

			vi.useFakeTimers({ toFake: ["Date"] });
			vi.setSystemTime(Date.now() + 6 * 60 * 1000);

			try {
				expect((await send(upload)).status).toBe(403);
			} finally {
				vi.useRealTimers();
			}

			expect(await snapshot()).toEqual(before);
		});

		it.each([
			["disabled", { enabled: false }],
			[
				"unticked",
				{
					capabilities: {
						collections: { media: { read: true, write: false } },
					},
				},
			],
		])(
			"refuses a key %s after the grant was issued",
			async (_label, change) => {
				const key = await createKey(booted.payload, {
					userId,
					label: `changed-${_label}`,
					capabilities: CAPABILITIES,
				});
				const upload = await issue(
					"createDocument",
					createArgs("Changed"),
					createMcpClient(booted, key),
				);
				const { docs } = await booted.payload.find({
					collection: API_KEYS_SLUG as never,
					where: { label: { equals: `changed-${_label}` } },
					overrideAccess: true,
				});

				await booted.payload.update({
					collection: API_KEYS_SLUG as never,
					id: docs[0]!.id,
					data: change,
					overrideAccess: true,
				});

				const before = await snapshot();

				expect((await send(upload)).status).toBe(403);
				expect(await snapshot()).toEqual(before);
			},
		);

		it("refuses a body whose size differs from the declared one", async () => {
			const before = await snapshot();
			const upload = await issue("createDocument", {
				...createArgs("Short"),
				file: { ...fileOf("short.png"), size: PIXEL.length + 1 },
			});

			expect((await send(upload)).status).toBe(400);
			expect(await snapshot()).toEqual(before);
		});

		it("stops a chunked body once it passes the declared size", async () => {
			const before = await snapshot();
			const upload = await issue("createDocument", createArgs("Chunked"));
			const body = new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(PIXEL);
					controller.enqueue(PIXEL);
					controller.close();
				},
			});
			const response = await uploadPut(booted, {
				url: upload.url,
				headers: upload.headers,
				body,
			});

			expect(response.status).toBe(400);
			expect(await snapshot()).toEqual(before);
		});

		it("refuses content outside upload.mimeTypes", async () => {
			const before = await snapshot();
			const upload = await issue("createDocument", {
				...createArgs("Disguised"),
				file: fileOf("disguised.png", PDF),
			});
			const { status, data } = await send(upload, { body: PDF });

			expect(status).toBe(422);
			expect(JSON.stringify(data)).toContain("application/pdf");
			expect(await snapshot()).toEqual(before);
		});

		it("refuses a document changed since the grant was issued", async () => {
			const { id } = await createMedia(booted.payload, "Stale");
			const upload = await issue("patchDocument", {
				collection: "media",
				id,
				locale: "en",
				patches: [],
				file: fileOf("stale.png"),
			});

			await booted.payload.update({
				collection: "media" as never,
				id,
				locale: "en",
				data: { alt: "Changed elsewhere" },
				draft: true,
				overrideAccess: true,
			});

			const before = await snapshot();
			const { status, data } = await send(upload);

			expect(status).toBe(409);
			expect(data).toHaveProperty("updatedAt");
			expect(await snapshot()).toEqual(before);
		});

		/*
		 * The lock holder also sends its admin cookie: acting as it would lift
		 * the lock, so the refusal shows the key's user still acts.
		 */
		it("refuses a document another user has locked, whatever cookie is sent", async () => {
			const { payload } = booted;
			const other = await payload.create({
				collection: "users",
				data: { email: "other@example.com", password: "other-secret" },
			});
			const { token } = await payload.login({
				collection: "users",
				data: { email: "other@example.com", password: "other-secret" },
			});
			const { id } = await createMedia(payload, "Locked");
			const upload = await issue("patchDocument", {
				collection: "media",
				id,
				locale: "en",
				patches: [],
				file: fileOf("locked.png"),
			});

			await payload.create({
				collection: "payload-locked-documents",
				data: {
					document: { relationTo: "media" as never, value: id },
					user: { relationTo: "users", value: other.id },
				},
				overrideAccess: true,
			});

			const before = await snapshot();
			const { status } = await send(upload, {
				headers: { cookie: `payload-token=${String(token)}` },
			});

			expect(status).toBe(409);
			expect(await snapshot()).toEqual(before);
		});
	});

	describe("downloads", () => {
		interface Download {
			url: string;
			method: string;
			headers: Record<string, string>;
		}

		const issueDownload = async (
			collection: string,
			id: number | string,
			client: McpClient = mcp,
		): Promise<Download> => {
			const result = await client.call("getDocument", {
				collection,
				id,
				download: true,
			});

			expect(result.isError).toBe(false);

			return result.data["download"] as Download;
		};

		const fetchFile = (download: Download) =>
			endpointGet(booted, download.url, download.headers);

		it("serves the file through the collection's own file endpoint", async () => {
			const { id } = await createMedia(booted.payload, "Served");
			const download = await issueDownload("media", id);

			expect(download).toMatchObject({
				url: "http://localhost/api/mcpx/file",
				method: "GET",
			});

			const response = await fetchFile(download);

			expect(response.status).toBe(200);
			expect(response.headers.get("content-type")).toBe("image/png");
			expect(Buffer.from(await response.arrayBuffer())).toEqual(PIXEL);
		});

		it("leaves Payload's own file route closed to an anonymous request", async () => {
			const { id } = await createMedia(booted.payload, "Closed");
			const { filename } = await readDoc("media", id);
			const response = await endpointGet(
				booted,
				`http://localhost/api/media/file/${String(filename)}`,
			);

			expect(response.status).toBe(403);
		});

		it("ignores ?prefix and ?locale on the download URL", async () => {
			const { id } = await createMedia(booted.payload, "Steered");
			const download = await issueDownload("media", id);
			const response = await fetchFile({
				...download,
				url: `${download.url}?prefix=elsewhere&locale=de`,
			});

			expect(response.status).toBe(200);
			expect(Buffer.from(await response.arrayBuffer())).toEqual(PIXEL);
		});

		it("refuses an upload grant at the download endpoint", async () => {
			const upload = await issue("createDocument", {
				collection: "media",
				locale: "en",
				data: { alt: "Crossed" },
				file: fileOf("crossed.png"),
			});
			const response = await endpointGet(
				booted,
				"http://localhost/api/mcpx/file",
				upload.headers,
			);

			expect(response.status).toBe(403);
		});

		it("refuses a download grant at the upload endpoint", async () => {
			const { id } = await createMedia(booted.payload, "Crossed back");
			const download = await issueDownload("media", id);
			const before = await snapshot();
			const response = await uploadPut(booted, {
				url: "http://localhost/api/mcpx/upload",
				headers: {
					...download.headers,
					"content-type": "image/png",
					"content-length": String(PIXEL.length),
				},
				body: PIXEL,
			});

			expect(response.status).toBe(403);
			expect(await snapshot()).toEqual(before);
		});

		it("refuses a grant used before", async () => {
			const { id } = await createMedia(booted.payload, "Once");
			const download = await issueDownload("media", id);

			expect((await fetchFile(download)).status).toBe(200);
			expect((await fetchFile(download)).status).toBe(403);
		});

		it("refuses a key whose read was unticked after the grant was issued", async () => {
			const key = await createKey(booted.payload, {
				userId,
				label: "download-unticked",
				capabilities: CAPABILITIES,
			});
			const { id } = await createMedia(booted.payload, "Unticked");
			const download = await issueDownload(
				"media",
				id,
				createMcpClient(booted, key),
			);
			const { docs } = await booted.payload.find({
				collection: API_KEYS_SLUG as never,
				where: { label: { equals: "download-unticked" } },
				overrideAccess: true,
			});

			await booted.payload.update({
				collection: API_KEYS_SLUG as never,
				id: docs[0]!.id,
				data: {
					capabilities: {
						collections: {
							media: { read: false, write: false, publish: false },
						},
					},
				},
				overrideAccess: true,
			});

			expect((await fetchFile(download)).status).toBe(403);
		});

		it("serves only documents the user can still read", async () => {
			const shown = await createFile("Shown");
			const hidden = await createFile("Later hidden");
			const [shownDownload, hiddenDownload] = await Promise.all([
				issueDownload("files", shown.id),
				issueDownload("files", hidden.id),
			]);

			await booted.payload.update({
				collection: "files" as never,
				id: hidden.id,
				data: { alt: "Hidden" },
				overrideAccess: true,
			});

			expect((await fetchFile(shownDownload)).status).toBe(200);
			expect((await fetchFile(hiddenDownload)).status).toBe(403);
		});

		it.each([
			["a collection without files", "pages"],
			["an upload collection with its own download field", "attachments"],
		])("refuses download for %s", async (_label, collection) => {
			const grants = await grantsIn(booted.payload);
			const result = await mcp.call("getDocument", {
				collection,
				id: 1,
				download: true,
			});

			expect(result.isError).toBe(true);
			expect(result.data["error"]).toBe(
				`"${collection}" has no file to download.`,
			);
			expect(await grantsIn(booted.payload)).toBe(grants);
		});
	});
});
