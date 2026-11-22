import { payloadMajor } from "@internal/test-utils/payload-major";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handleEndpoints } from "payload";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
	collectionEnumOf,
	createMcpClient,
	endpointGet,
	mcpPost,
	uploadPut,
} from "./helpers/mcp.js";
import {
	API_KEYS_SLUG,
	bootPayload,
	createKey,
	PIXEL,
	storedState,
	USER,
} from "./helpers/payload.js";
import { strategyUsers } from "../fixtures/security.js";

import type { McpClient } from "./helpers/mcp.js";
import type { Booted } from "./helpers/payload.js";
import type { CollectionConfig } from "payload";

const CACHE_KEY = "mcpx-auth-strategy";

const ENDPOINT = "http://localhost/api/mcpx/confirmations";

const SCANS_DIR = join(
	tmpdir(),
	`mcpx-fixture-scans-v${String(payloadMajor())}`,
);

// An upload collection without drafts or localized fields.
const scans: CollectionConfig = {
	slug: "scans",
	upload: { staticDir: SCANS_DIR, mimeTypes: ["image/*"] },
	fields: [{ name: "alt", type: "text", required: true }],
};

const OTHER = { email: "other@example.com", password: "other-secret" };

interface Confirmation {
	id: string;
	principal: string;
	expiresAt: string;
	url?: string;
}

interface Upload {
	url: string;
	headers: Record<string, string>;
}

describe("capabilities from a Payload auth strategy", () => {
	let booted: Booted;
	let ownerId: number | string;
	let otherId: number | string;
	let ownerCookie: string;
	let otherCookie: string;
	let owner: McpClient;
	let other: McpClient;

	const bearer = (id: number | string): string => `test-${String(id)}`;

	const send = async (
		url: string,
		args: {
			method?: string;
			cookie?: string;
			key?: string;
			body?: unknown;
		} = {},
	): Promise<{ status: number; data: Record<string, unknown> }> => {
		const response = await handleEndpoints({
			config: booted.config,
			payloadInstanceCacheKey: booted.cacheKey,
			request: new Request(url, {
				method: args.method ?? "GET",
				headers: {
					"content-type": "application/json",
					...(args.cookie === undefined ? {} : { cookie: args.cookie }),
					...(args.key === undefined
						? {}
						: { authorization: `Bearer ${args.key}` }),
				},
				...(args.body === undefined ? {} : { body: JSON.stringify(args.body) }),
			}),
		});

		return {
			status: response.status,
			data: (await response.json()) as Record<string, unknown>,
		};
	};

	// The handle of the call `confirmation`, as `cookie`'s user sees it.
	const handleOf = async (
		cookie: string,
		confirmation: Confirmation,
	): Promise<string | undefined> => {
		const query = new URLSearchParams({
			principal: confirmation.principal,
			confirmation: confirmation.id,
		});
		const { data } = await send(`${ENDPOINT}?${query.toString()}`, { cookie });

		return (
			data["confirmations"] as { handle: string; highlighted: boolean }[]
		).find((entry) => entry.highlighted)?.handle;
	};

	const decide = async (
		args: { cookie?: string; key?: string },
		body: { principal: string; handles: string[] },
	) =>
		await send(ENDPOINT, {
			...args,
			method: "POST",
			body: { ...body, decision: "approved" },
		});

	const createTag = async (name: string) =>
		await booted.payload.create({
			collection: "tags",
			data: { name },
			overrideAccess: true,
		});

	const requestDelete = async (client: McpClient, id: number | string) =>
		(await client.call("deleteDocument", { collection: "tags", id })).data[
			"confirmation"
		] as Confirmation;

	const kvRows = async (): Promise<unknown[]> =>
		(
			await booted.payload.find({
				collection: "payload-kv" as never,
				pagination: false,
				overrideAccess: true,
			})
		).docs;

	const snapshot = async () => ({
		state: await storedState(booted.payload, {
			collections: ["tags", "scans", API_KEYS_SLUG],
		}),
		kv: await kvRows(),
	});

	beforeAll(async () => {
		booted = await bootPayload({
			key: CACHE_KEY,
			users: strategyUsers({
				collections: {
					pages: { read: true, write: true, publish: true },
					tags: { read: true, delete: true },
					scans: { read: true, write: true },
				},
				tools: { echo: true },
			}),
			collections: [scans],
			plugin: {
				collections: {
					pages: { publish: false },
					tags: { write: false, delete: true },
					scans: true,
				},
			},
		});

		const create = async (data: typeof USER) =>
			(
				await booted.payload.create({
					collection: "users",
					data,
					overrideAccess: true,
				})
			).id;
		const login = async (data: typeof USER) =>
			`payload-token=${String((await booted.payload.login({ collection: "users", data })).token)}`;

		ownerId = await create(USER);
		otherId = await create(OTHER);
		ownerCookie = await login(USER);
		otherCookie = await login(OTHER);
		owner = createMcpClient(booted, bearer(ownerId));
		other = createMcpClient(booted, bearer(otherId));
	});

	afterAll(async () => {
		await booted.payload.destroy();
		await rm(SCANS_DIR, { recursive: true, force: true });
	});

	describe("the MCP endpoint", () => {
		it("offers what both the config and the attached capabilities allow", async () => {
			const tools = await owner.list();
			const names = tools.map((tool) => tool.name);

			expect(names).toEqual(
				expect.arrayContaining([
					"findDocuments",
					"patchDocument",
					"deleteDocument",
					"runConfirmed",
					"echo",
				]),
			);
			expect(names).not.toContain("publishDocument");
			expect(names).not.toContain("whichCollection");
			expect(
				collectionEnumOf(tools.find((tool) => tool.name === "deleteDocument")),
			).toEqual(["tags"]);
		});

		it("acts as the strategy's user without a key", async () => {
			const result = await owner.call("echo", { message: "hi" });

			expect(result.data).toEqual({ message: "hi", userId: ownerId });
		});

		it("refuses a session cookie alone", async () => {
			const response = await mcpPost(booted, {
				headers: { cookie: ownerCookie },
				body: { jsonrpc: "2.0", id: 1, method: "tools/list" },
			});

			expect(response.status).toBe(401);
			expect(response.headers.get("www-authenticate")).toBe("Bearer");
		});
	});

	describe("confirmations", () => {
		it("binds a delete to the principal and offers no url", async () => {
			const tag = await createTag("Bound");
			const confirmation = await requestDelete(owner, tag.id);

			expect(confirmation).toEqual({
				id: expect.any(String),
				principal: `test:${String(ownerId)}`,
				expiresAt: expect.any(String),
			});
		});

		it("lets only the user who requested a call decide", async () => {
			const tag = await createTag("Decided");
			const confirmation = await requestDelete(owner, tag.id);
			const { id, principal } = confirmation;

			expect(await handleOf(otherCookie, confirmation)).toBeUndefined();

			const handle = (await handleOf(ownerCookie, confirmation))!;
			const body = { principal, handles: [handle] };
			const before = await snapshot();

			expect(await decide({ cookie: otherCookie }, body)).toEqual({
				status: 200,
				data: { decided: [] },
			});
			expect(await snapshot()).toEqual(before);
			expect(
				(await owner.call("runConfirmed", { ids: [id] })).data["results"],
			).toEqual([{ id, status: "pending" }]);

			expect(await decide({ cookie: ownerCookie }, body)).toEqual({
				status: 200,
				data: { decided: [handle] },
			});
			expect(
				(await owner.call("runConfirmed", { ids: [id] })).data["results"],
			).toMatchObject([{ id, status: "done" }]);
		});

		it("refuses a decision without the JSON content type and changes nothing", async () => {
			const tag = await createTag("Form post");
			const confirmation = await requestDelete(owner, tag.id);
			const { id, principal } = confirmation;
			const handle = (await handleOf(ownerCookie, confirmation))!;
			const before = await snapshot();
			const response = await handleEndpoints({
				config: booted.config,
				payloadInstanceCacheKey: booted.cacheKey,
				request: new Request(ENDPOINT, {
					method: "POST",
					headers: { "content-type": "text/plain", cookie: ownerCookie },
					body: JSON.stringify({
						principal,
						handles: [handle],
						decision: "approved",
					}),
				}),
			});

			expect(response.status).toBe(415);
			expect(await snapshot()).toEqual(before);
			expect(
				(await owner.call("runConfirmed", { ids: [id] })).data["results"],
			).toEqual([{ id, status: "pending" }]);
		});

		it("refuses to list or decide for a request that carries capabilities", async () => {
			const tag = await createTag("Self-approved");
			const confirmation = await requestDelete(owner, tag.id);
			const { principal } = confirmation;
			const handle = (await handleOf(ownerCookie, confirmation))!;
			const before = await snapshot();

			expect(
				(
					await decide(
						{ key: bearer(ownerId) },
						{ principal, handles: [handle] },
					)
				).status,
			).toBe(403);
			expect(
				(
					await send(`${ENDPOINT}?principal=${principal}`, {
						key: bearer(ownerId),
					})
				).status,
			).toBe(403);
			expect(await snapshot()).toEqual(before);
		});

		it("runs an approved call only for the user it was issued to, under a shared principal", async () => {
			const sharedOwner = createMcpClient(booted, `shared-${String(ownerId)}`);
			const sharedOther = createMcpClient(booted, `shared-${String(otherId)}`);
			const tag = await createTag("Shared principal");
			const confirmation = await requestDelete(sharedOwner, tag.id);
			const { id, principal } = confirmation;

			expect(principal).toBe("test:shared");

			await decide(
				{ cookie: ownerCookie },
				{ principal, handles: [(await handleOf(ownerCookie, confirmation))!] },
			);

			const before = await snapshot();

			expect(
				(await sharedOther.call("runConfirmed", { ids: [id] })).data["results"],
			).toEqual([{ id, status: "refused" }]);
			expect(await snapshot()).toEqual(before);
			expect(
				(await sharedOwner.call("runConfirmed", { ids: [id] })).data["results"],
			).toMatchObject([{ id, status: "done" }]);
		});

		it("runs an approved call only for its own principal", async () => {
			const tag = await createTag("Own principal");
			const confirmation = await requestDelete(owner, tag.id);
			const { id, principal } = confirmation;

			await decide(
				{ cookie: ownerCookie },
				{ principal, handles: [(await handleOf(ownerCookie, confirmation))!] },
			);

			const before = await snapshot();

			expect(
				(await other.call("runConfirmed", { ids: [id] })).data["results"],
			).toEqual([{ id, status: "refused" }]);
			expect(await snapshot()).toEqual(before);
			expect(
				(await owner.call("runConfirmed", { ids: [id] })).data["results"],
			).toMatchObject([{ id, status: "done" }]);
		});
	});

	describe("uploads", () => {
		const put = async (upload: Upload, key?: string) =>
			(
				await uploadPut(booted, {
					url: upload.url,
					headers: {
						...upload.headers,
						"content-length": String(PIXEL.length),
						...(key === undefined ? {} : { authorization: `Bearer ${key}` }),
					},
					body: PIXEL,
				})
			).status;

		it("claims a grant only with the bearer of its principal", async () => {
			const result = await owner.call("createDocument", {
				collection: "scans",
				locale: "en",
				data: { alt: "Scanned" },
				file: {
					filename: "scan.png",
					mimeType: "image/png",
					size: PIXEL.length,
				},
			});
			const upload = result.data["upload"] as Upload;
			const before = await snapshot();

			expect(await put(upload)).toBe(403);
			expect(await put(upload, bearer(otherId))).toBe(403);
			expect(await snapshot()).toEqual(before);

			expect(await put(upload, bearer(ownerId))).toBe(200);
			expect(
				(
					await booted.payload.find({
						collection: "scans" as never,
						where: { alt: { equals: "Scanned" } },
						overrideAccess: true,
					})
				).totalDocs,
			).toBe(1);
		});

		it("serves a download grant only with the bearer of its principal", async () => {
			const scan = await booted.payload.create({
				collection: "scans" as never,
				data: { alt: "Downloaded" },
				file: {
					data: PIXEL,
					mimetype: "image/png",
					name: "downloaded.png",
					size: PIXEL.length,
				},
				overrideAccess: true,
			});
			const result = await owner.call("getDocument", {
				collection: "scans",
				id: scan.id,
				download: true,
			});
			const download = result.data["download"] as Upload;
			const fetchAs = async (key?: string) =>
				await endpointGet(booted, download.url, {
					...download.headers,
					...(key === undefined ? {} : { authorization: `Bearer ${key}` }),
				});

			expect((await fetchAs()).status).toBe(403);
			expect((await fetchAs(bearer(otherId))).status).toBe(403);

			const served = await fetchAs(bearer(ownerId));

			expect(served.status).toBe(200);
			expect(Buffer.from(await served.arrayBuffer())).toEqual(PIXEL);
		});
	});

	describe("the API key collection", () => {
		const KEYS = `http://localhost/api/${API_KEYS_SLUG}`;

		it("refuses every operation to a request that carries capabilities", async () => {
			await createKey(booted.payload, {
				userId: ownerId,
				label: "owned",
				capabilities: {},
			});

			const { docs } = await booted.payload.find({
				collection: API_KEYS_SLUG as never,
				where: { label: { equals: "owned" } },
				overrideAccess: true,
			});
			const key = bearer(ownerId);
			const one = `${KEYS}/${String(docs[0]!.id)}`;
			const before = await snapshot();

			expect(
				(
					await send(KEYS, {
						method: "POST",
						key,
						body: { label: "minted", user: ownerId },
					})
				).status,
			).toBe(403);
			expect((await send(KEYS, { key })).status).toBe(403);
			expect((await send(one, { key })).status).toBe(403);
			expect(
				(
					await send(one, {
						method: "PATCH",
						key,
						body: { label: "renamed" },
					})
				).status,
			).toBe(403);
			expect((await send(one, { method: "DELETE", key })).status).toBe(403);
			expect(await snapshot()).toEqual(before);

			expect((await send(one, { cookie: ownerCookie })).data["label"]).toBe(
				"owned",
			);
		});
	});
});
