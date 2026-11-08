import { mcpxPlugin } from "@abinnovision/payloadcms-mcpx";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	createPayloadRequest,
	handleEndpoints,
	inMemoryKVAdapter,
} from "payload";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
	bootPayload,
	count,
	keySettings,
	login,
	shutdown,
	THREADS_SLUG,
} from "./helpers/payload.js";
import { exchangeSession } from "../../src/agent/exchange.js";
import { FlueUploadError, uploadDocument } from "../../src/agent/upload.js";
import { fluePlugin } from "../../src/index.js";
import { ensureAgentKey } from "../../src/keys/manager.js";
import { handleHash } from "../../src/threads/handle.js";
import { SIDECAR_SECRET } from "../fixtures/config.js";

import type { Booted } from "./helpers/payload.js";
import type { UploadTarget } from "../../src/agent/upload.js";
import type { FlueAgentConfig } from "../../src/index.js";
import type { CollectionConfig, Config } from "payload";

const PAYLOAD_URL = "http://localhost";
const PUBLIC_URL = "https://cms.example.com";
const TEXT = "A summary of the page.\n";

const UPLOADER: FlueAgentConfig = {
	slug: "uploader",
	capabilities: {
		collections: {
			files: { read: true, write: true },
			archive: { read: true },
		},
	},
};

const users: CollectionConfig = { slug: "users", auth: true, fields: [] };

const uploadCollection = (
	slug: string,
	staticDir: string,
): CollectionConfig => ({
	slug,
	upload: { staticDir, mimeTypes: ["application/pdf", "text/plain"] },
	fields: [
		{ name: "alt", type: "text", localized: true },
		// Records who wrote the document, as the key's user.
		{
			name: "uploadedBy",
			type: "text",
			hooks: {
				beforeChange: [({ req }) => (req.user ? String(req.user.id) : null)],
			},
		},
	],
});

/*
 * Localized, with a public `serverURL` the sidecar is not meant to reach, so
 * the handoff names another origin than the one the PUT goes to.
 */
const uploadConfig = (staticDir: string, extra: Partial<Config> = {}) => ({
	serverURL: PUBLIC_URL,
	localization: { locales: ["en", "de"], defaultLocale: "en" },
	collections: [
		users,
		uploadCollection("files", join(staticDir, "files")),
		uploadCollection("archive", join(staticDir, "archive")),
	],
	plugins: [
		mcpxPlugin({ collections: { files: {}, archive: {} } }),
		fluePlugin({
			sidecar: { url: "http://127.0.0.1:9", secret: SIDECAR_SECRET },
			agents: [UPLOADER],
		}),
	],
	...extra,
});

interface Recorded {
	url: string;
	method: string;
	headers: Headers;
}

/** Routes requests through Payload's router and records them. */
const routedFetch =
	(booted: Booted, requests: Recorded[]): typeof fetch =>
	async (input: RequestInfo | URL, init?: RequestInit) => {
		const request = new Request(input, init);

		requests.push({
			url: request.url,
			method: request.method,
			headers: request.headers,
		});

		return await handleEndpoints({
			config: booted.config,
			payloadInstanceCacheKey: booted.cacheKey,
			request,
		});
	};

/** A live conversation of a fresh user and the upload target for it. */
const startConversation = async (
	booted: Booted,
	requests: Recorded[] = [],
): Promise<{ userId: number | string; target: UploadTarget }> => {
	const credentials = {
		email: `${randomUUID()}@example.com`,
		password: "upload-secret",
	};
	const user = await booted.payload.create({
		collection: "users",
		data: credentials,
		overrideAccess: true,
	});
	const handle = randomUUID();

	await login(booted.payload, "users", credentials);
	await booted.payload.create({
		collection: THREADS_SLUG,
		data: {
			agent: UPLOADER.slug,
			kind: "chat",
			conversationId: randomUUID(),
			handleHash: handleHash(handle),
			createdBy: { relationTo: "users", value: user.id },
		},
		overrideAccess: true,
	});
	await ensureAgentKey(booted.payload, keySettings(booted.payload), {
		userId: user.id,
		agent: UPLOADER,
		req: await createPayloadRequest({ payload: booted.payload }),
	});

	const fetch = routedFetch(booted, requests);

	return {
		userId: user.id,
		target: {
			session: exchangeSession({
				payloadUrl: PAYLOAD_URL,
				fluePath: "/api/flue",
				mcpPath: "/api/mcpx",
				secret: SIDECAR_SECRET,
				handle,
				agent: UPLOADER.slug,
				fetch,
			}),
			payloadUrl: PAYLOAD_URL,
			mcpPath: "/api/mcpx",
			fetch,
		},
	};
};

describe("uploadDocument", () => {
	let booted: Booted;
	let staticDir: string;

	const files = (): Promise<number> => count(booted, "files");

	const read = (id: number | string, locale: string) =>
		booted.payload.findByID({
			collection: "files",
			id,
			locale,
			fallbackLocale: false,
			overrideAccess: true,
		});

	beforeAll(async () => {
		staticDir = await mkdtemp(join(tmpdir(), "flue-upload-"));
		booted = await bootPayload(
			"flue-upload",
			undefined,
			uploadConfig(staticDir),
		);
	});

	afterAll(async () => {
		await shutdown(booted);
		await rm(staticDir, { recursive: true, force: true });
	});

	it("creates the document in the turn's locale as the key's user and puts the bytes below payloadUrl", async () => {
		const requests: Recorded[] = [];
		const { userId, target } = await startConversation(booted, requests);

		const file = await uploadDocument(
			{ ...target, locale: "de" },
			{
				collection: "files",
				filename: "summary.txt",
				mimeType: "text/plain",
				data: TEXT,
				fields: { alt: "Zusammenfassung" },
			},
		);
		const doc = await read(file.id, "de");
		const put = requests.find((request) => request.method === "PUT");

		expect(file).toEqual({
			collection: "files",
			id: doc.id,
			filename: "summary.txt",
			mimeType: "text/plain",
			size: TEXT.length,
			adminUrl: `${PUBLIC_URL}/admin/collections/files/${String(doc.id)}?locale=de`,
		});
		expect(doc["alt"]).toBe("Zusammenfassung");
		expect(doc["filesize"]).toBe(TEXT.length);
		expect(doc["uploadedBy"]).toBe(String(userId));
		expect(put?.url).toBe(`${PAYLOAD_URL}/api/mcpx/upload`);
		expect(put?.headers.get("authorization")).toBeNull();
	});

	it("uses an explicit locale over the turn's", async () => {
		const { target } = await startConversation(booted);

		const file = await uploadDocument(
			{ ...target, locale: "de" },
			{
				collection: "files",
				filename: "notes.txt",
				mimeType: "text/plain",
				data: "notes",
				fields: { alt: "Notes" },
				locale: "en",
			},
		);

		expect((await read(file.id, "en"))["alt"]).toBe("Notes");
		expect((await read(file.id, "de"))["alt"]).toBeFalsy();
	});

	it("refuses without any locale on a localized config and creates nothing", async () => {
		const { target } = await startConversation(booted);
		const before = await files();
		const error: unknown = await uploadDocument(target, {
			collection: "files",
			filename: "a.txt",
			mimeType: "text/plain",
			data: TEXT,
		}).catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(FlueUploadError);
		expect(String(error)).toContain("needs a locale");
		expect(await files()).toBe(before);
	});

	it.each([
		["a type outside upload.mimeTypes", "files", "image/png"],
		["a collection the agent cannot write", "archive", "application/pdf"],
	])("refuses %s and creates nothing", async (_label, collection, mimeType) => {
		const { target } = await startConversation(booted);
		const before = [await files(), await count(booted, "archive")];

		await expect(
			uploadDocument(
				{ ...target, locale: "en" },
				{ collection, filename: "a.bin", mimeType, data: TEXT },
			),
		).rejects.toBeInstanceOf(FlueUploadError);
		expect([await files(), await count(booted, "archive")]).toEqual(before);
	});

	it("keeps the grant out of a failed PUT's error", async () => {
		const requests: Recorded[] = [];
		const { target } = await startConversation(booted, requests);
		const before = await files();
		// Declares one byte more than it sends, so mcpx refuses the body.
		const shortFetch = (async (input: RequestInfo | URL, init?: RequestInit) =>
			await (target.fetch ?? fetch)(
				input,
				init?.method === "PUT" ? { ...init, body: "x" } : init,
			)) as typeof fetch;
		const error: unknown = await uploadDocument(
			{ ...target, fetch: shortFetch, locale: "en" },
			{
				collection: "files",
				filename: "a.txt",
				mimeType: "text/plain",
				data: TEXT,
			},
		).catch((caught: unknown) => caught);
		const grant = requests
			.find((request) => request.method === "PUT")
			?.headers.get("x-mcpx-grant");

		expect(error).toBeInstanceOf(FlueUploadError);
		expect(error).toMatchObject({ status: 400 });
		expect(grant).toEqual(expect.any(String));
		expect(String(error)).not.toContain(grant);
		expect(await files()).toBe(before);
	});
});

describe("uploadDocument without mcpx leases", () => {
	let booted: Booted;
	let staticDir: string;

	beforeAll(async () => {
		staticDir = await mkdtemp(join(tmpdir(), "flue-upload-kv-"));
		booted = await bootPayload(
			"flue-upload-memory-kv",
			undefined,
			uploadConfig(staticDir, { kv: inMemoryKVAdapter() }),
		);
	});

	afterAll(async () => {
		await shutdown(booted);
		await rm(staticDir, { recursive: true, force: true });
	});

	// mcpx leaves createDocument out of an upload-capable key without leases.
	it("refuses without a createDocument tool and creates nothing", async () => {
		const { target } = await startConversation(booted);
		const error: unknown = await uploadDocument(
			{ ...target, locale: "en" },
			{
				collection: "files",
				filename: "a.txt",
				mimeType: "text/plain",
				data: TEXT,
			},
		).catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(FlueUploadError);
		expect(String(error)).toContain("createDocument not found");
		expect(await count(booted, "files")).toBe(0);
	});
});
