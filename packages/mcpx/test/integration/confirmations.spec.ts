import { handleEndpoints } from "payload";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { createMcpClient } from "./helpers/mcp.js";
import {
	API_KEYS_SLUG,
	bootPayload,
	createKey,
	seedKeysFor,
	storedState,
	USER,
} from "./helpers/payload.js";

import type { McpClient } from "./helpers/mcp.js";
import type { Booted, KeyCapabilities } from "./helpers/payload.js";
import type { CollectionConfig } from "payload";

const CACHE_KEY = "mcpx-confirmations";

const ENDPOINT = "http://localhost/api/mcpx/confirmations";

/*
 * Trash and drafts. Its user reads every document except "Secret" and may
 * delete every document except "Kept".
 */
const bins: CollectionConfig = {
	slug: "bins",
	trash: true,
	versions: { drafts: true },
	admin: { useAsTitle: "title" },
	access: {
		read: ({ req }) => (req.user ? { title: { not_equals: "Secret" } } : false),
		delete: ({ req }) => (req.user ? { title: { not_equals: "Kept" } } : false),
	},
	fields: [{ name: "title", type: "text" }],
};

const CAPABILITIES: KeyCapabilities = {
	collections: {
		tags: { read: true, delete: true },
		bins: { read: true, delete: true },
	},
};

const OTHER = { email: "other@example.com", password: "other-secret" };

type Doc = Record<string, unknown> & { id: number | string };

interface Confirmation {
	id: string;
	url: string;
	expiresAt: string;
}

interface Listed {
	handle: string;
	tool: string;
	group: string;
	highlighted: boolean;
	summary: Record<string, unknown>;
}

describe("confirmed deletes", () => {
	let booted: Booted;
	let mcp: McpClient;
	let keyId: number | string;
	let ownerCookie: string;
	let otherCookie: string;

	const send = async (
		method: "GET" | "POST",
		args: { cookie?: string; query?: string; body?: unknown },
	): Promise<{ status: number; data: Record<string, unknown> }> => {
		const response = await handleEndpoints({
			config: booted.config,
			payloadInstanceCacheKey: booted.cacheKey,
			request: new Request(`${ENDPOINT}${args.query ?? ""}`, {
				method,
				headers: {
					"content-type": "application/json",
					...(args.cookie === undefined ? {} : { cookie: args.cookie }),
				},
				...(args.body === undefined ? {} : { body: JSON.stringify(args.body) }),
			}),
		});

		return {
			status: response.status,
			data: (await response.json()) as Record<string, unknown>,
		};
	};

	const list = async (
		confirmationId?: string,
		key: number | string = keyId,
	): Promise<Listed[]> => {
		const query = new URLSearchParams({ key: String(key) });

		if (confirmationId !== undefined) {
			query.set("confirmation", confirmationId);
		}

		const { data } = await send("GET", {
			cookie: ownerCookie,
			query: `?${query.toString()}`,
		});

		return data["confirmations"] as Listed[];
	};

	const handleOf = async (id: string): Promise<string> => {
		const entry = (await list(id)).find((candidate) => candidate.highlighted);

		if (!entry) {
			throw new Error("The confirmation is not listed.");
		}

		return entry.handle;
	};

	const decide = async (id: string, decision: "approved" | "rejected") =>
		await send("POST", {
			cookie: ownerCookie,
			body: { key: keyId, handles: [await handleOf(id)], decision },
		});

	const request = async (
		client: McpClient,
		args: Record<string, unknown>,
	): Promise<Confirmation> => {
		const result = await client.call("deleteDocument", args);

		expect(result.isError).toBe(false);

		return result.data["confirmation"] as Confirmation;
	};

	const run = async (
		ids: string[],
		client: McpClient = mcp,
	): Promise<Record<string, unknown>[]> =>
		(await client.call("runConfirmed", { ids })).data["results"] as Record<
			string,
			unknown
		>[];

	const createTag = async (name: string): Promise<Doc> =>
		await booted.payload.create({
			collection: "tags",
			data: { name },
		});

	const createBin = async (title: string): Promise<Doc> =>
		await booted.payload.create({
			collection: "bins" as never,
			data: { title, _status: "published" },
			draft: false,
			overrideAccess: true,
		});

	const exists = async (collection: string, id: number | string) =>
		(
			await booted.payload.find({
				collection: collection as never,
				where: { id: { equals: id } },
				trash: true,
				overrideAccess: true,
			})
		).docs[0] as Doc | undefined;

	// The calls stored in Payload's KV, of every key.
	const storedCalls = async (): Promise<number> => {
		const { docs } = await booted.payload.find({
			collection: "payload-kv" as never,
			pagination: false,
			overrideAccess: true,
		});

		return docs.filter((doc) =>
			String((doc as { key?: unknown }).key).startsWith("mcpx-confirmation:"),
		).length;
	};

	const snapshot = async () => ({
		state: await storedState(booted.payload, {
			collections: ["tags", "bins"],
		}),
		calls: await storedCalls(),
	});

	beforeAll(async () => {
		booted = await bootPayload({
			key: CACHE_KEY,
			collections: [bins],
			plugin: {
				collections: {
					tags: { write: false, delete: true },
					bins: { delete: "unattended" },
					pages: { publish: false },
				},
			},
		});

		const seeded = await seedKeysFor(booted.payload, {
			deleter: CAPABILITIES,
		});

		mcp = createMcpClient(booted, seeded.keys.deleter);
		keyId = (
			await booted.payload.find({
				collection: API_KEYS_SLUG as never,
				where: { label: { equals: "deleter" } },
				overrideAccess: true,
			})
		).docs[0]!.id;

		await booted.payload.create({ collection: "users", data: OTHER });

		const login = async (data: typeof USER) =>
			`payload-token=${String((await booted.payload.login({ collection: "users", data })).token)}`;

		ownerCookie = await login(USER);
		otherCookie = await login(OTHER);
	});

	afterAll(async () => {
		await booted.payload.destroy();
	});

	describe("deleteDocument", () => {
		it("stores the call and deletes nothing", async () => {
			const tag = await createTag("Stored");
			const before = await snapshot();
			const confirmation = await request(mcp, {
				collection: "tags",
				id: tag.id,
				reason: "Duplicate of another tag.",
			});
			const after = await snapshot();

			expect(confirmation.url).toBe(
				`http://localhost/admin/collections/${API_KEYS_SLUG}/${String(keyId)}?confirmation=${confirmation.id}`,
			);
			expect(after.state).toEqual(before.state);
			expect(after.calls).toBe(before.calls + 1);
		});

		it("offers no global and only the collections the key may delete", async () => {
			const tool = (await mcp.list()).find(
				(candidate) => candidate.name === "deleteDocument",
			);
			const properties = tool?.inputSchema["properties"] as Record<
				string,
				{ enum?: string[] }
			>;

			expect(properties["collection"]?.enum).toEqual(["tags", "bins"]);
			expect(properties).not.toHaveProperty("global");
		});

		it.each([
			["an unknown document", () => ({ collection: "tags", id: 999_999 })],
			[
				"a collection outside the key's capability",
				async () => ({
					collection: "pages",
					id: (await createTag("Elsewhere")).id,
				}),
			],
			[
				"a document the user cannot read",
				async () => ({
					collection: "bins",
					id: (await createBin("Secret")).id,
				}),
			],
			[
				"a document the user may not delete",
				async () => ({ collection: "bins", id: (await createBin("Kept")).id }),
			],
			[
				"a document already in the trash",
				async () => {
					const bin = await createBin("Trashed");

					await booted.payload.update({
						collection: "bins" as never,
						id: bin.id,
						data: { deletedAt: new Date().toISOString() },
						overrideAccess: true,
					});

					return { collection: "bins", id: bin.id };
				},
			],
			[
				"a document changed since it was read",
				async () => ({
					collection: "tags",
					id: (await createTag("Stale")).id,
					expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
				}),
			],
		])("refuses %s and stores nothing", async (_label, argsOf) => {
			const args = await argsOf();
			const before = await snapshot();
			const result = await mcp.call("deleteDocument", args);

			expect(result.isError || result.rpcError !== undefined).toBe(true);
			expect(result.data).not.toHaveProperty("confirmation");
			expect(await snapshot()).toEqual(before);
		});
	});

	describe("unattended deletes", () => {
		it("moves to trash at once for a key with the checkbox, storing nothing", async () => {
			const key = await createKey(booted.payload, {
				userId: (
					await booted.payload.find({
						collection: "users",
						where: { email: { equals: USER.email } },
					})
				).docs[0]!.id,
				label: "unattended",
				capabilities: {
					collections: {
						bins: { read: true, delete: true, deleteUnattended: true },
					},
				},
			});
			const bin = await createBin("Unattended");
			const calls = await storedCalls();
			const result = await createMcpClient(booted, key).call("deleteDocument", {
				collection: "bins",
				id: bin.id,
			});

			expect(result.data).toEqual({
				collection: "bins",
				id: bin.id,
				movedToTrash: true,
			});
			expect((await exists("bins", bin.id))?.["deletedAt"]).toEqual(
				expect.any(String),
			);
			expect(await storedCalls()).toBe(calls);
		});

		it("still asks for approval on a key without the checkbox", async () => {
			const bin = await createBin("Attended");
			const before = await snapshot();
			const confirmation = await request(mcp, {
				collection: "bins",
				id: bin.id,
			});

			expect(confirmation.id).toEqual(expect.any(String));
			expect((await snapshot()).state).toEqual(before.state);
		});
	});

	describe("the confirmations endpoints", () => {
		it("lists the key's pending calls with what they do", async () => {
			const tag = await createTag("Listed tag");
			const bin = await createBin("Listed bin");

			// A newer draft, while the published title is still live.
			await booted.payload.update({
				collection: "bins" as never,
				id: bin.id,
				data: { title: "Renamed bin" },
				draft: true,
				overrideAccess: true,
			});
			const permanent = await request(mcp, {
				collection: "tags",
				id: tag.id,
				reason: "Unused.",
			});

			await request(mcp, { collection: "bins", id: bin.id });

			const listed = await list(permanent.id);
			const ofTag = listed.find((entry) => entry.highlighted);
			const ofBin = listed.find(
				(entry) =>
					entry.summary["label"] === "Bin" &&
					entry.summary["id"] === String(bin.id),
			);

			expect(ofTag).toMatchObject({
				tool: "deleteDocument",
				group: "Delete documents",
				summary: {
					label: "Tag",
					id: String(tag.id),
					href: `/admin/collections/tags/${String(tag.id)}`,
					permanent: true,
					reason: "Unused.",
				},
			});
			expect(ofBin).toMatchObject({
				highlighted: false,
				summary: {
					label: "Bin",
					title: "Listed bin (draft: Renamed bin)",
					status: "published",
					permanent: false,
				},
			});
		});

		it("lets only the key's user decide", async () => {
			const tag = await createTag("Decided by owner");
			const { id } = await request(mcp, { collection: "tags", id: tag.id });
			const before = await snapshot();
			const handle = await handleOf(id);
			const body = { key: keyId, handles: [handle], decision: "approved" };

			expect((await send("POST", { cookie: otherCookie, body })).status).toBe(
				403,
			);
			expect((await send("POST", { body })).status).toBe(401);
			expect(
				(
					await send("GET", {
						cookie: otherCookie,
						query: `?key=${String(keyId)}`,
					})
				).status,
			).toBe(403);
			expect(await snapshot()).toEqual(before);
			expect(await run([id])).toEqual([{ id, status: "pending" }]);

			expect(await send("POST", { cookie: ownerCookie, body })).toEqual({
				status: 200,
				data: { decided: [handle] },
			});
		});
	});

	describe("runConfirmed", () => {
		it("reports a pending call as pending and keeps it", async () => {
			const tag = await createTag("Pending");
			const { id } = await request(mcp, { collection: "tags", id: tag.id });
			const before = await snapshot();

			expect(await run([id])).toEqual([{ id, status: "pending" }]);
			expect(await run([id])).toEqual([{ id, status: "pending" }]);
			expect(await snapshot()).toEqual(before);
			expect(await handleOf(id)).toMatch(/^[\da-f]{64}$/);
		});

		it("deletes an approved document for good, once", async () => {
			const tag = await createTag("Approved");
			const { id } = await request(mcp, { collection: "tags", id: tag.id });

			await decide(id, "approved");

			expect(await run([id])).toEqual([
				{
					id,
					status: "done",
					result: { collection: "tags", id: tag.id, movedToTrash: false },
				},
			]);
			expect(await exists("tags", tag.id)).toBeUndefined();
			expect(await run([id])).toEqual([{ id, status: "refused" }]);
		});

		it("moves an approved published document to trash", async () => {
			const bin = await createBin("To trash");
			const { id } = await request(mcp, { collection: "bins", id: bin.id });

			await decide(id, "approved");

			expect(await run([id])).toEqual([
				{
					id,
					status: "done",
					result: { collection: "bins", id: bin.id, movedToTrash: true },
				},
			]);
			expect((await exists("bins", bin.id))?.["deletedAt"]).toEqual(
				expect.any(String),
			);
			expect(
				(
					await booted.payload.find({
						collection: "bins" as never,
						where: { id: { equals: bin.id } },
						overrideAccess: true,
					})
				).totalDocs,
			).toBe(0);
		});

		it("refuses a rejected call and deletes nothing", async () => {
			const tag = await createTag("Rejected");
			const { id } = await request(mcp, { collection: "tags", id: tag.id });

			await decide(id, "rejected");

			const before = await snapshot();

			expect(await run([id])).toEqual([{ id, status: "refused" }]);
			expect(await snapshot()).toEqual(before);
		});

		it("refuses an expired call, which can no longer be approved", async () => {
			const tag = await createTag("Expired");
			const { id } = await request(mcp, { collection: "tags", id: tag.id });
			const handle = await handleOf(id);

			vi.useFakeTimers({ toFake: ["Date"] });
			vi.setSystemTime(Date.now() + 16 * 60 * 1000);

			try {
				const before = await snapshot();

				expect(
					(
						await send("POST", {
							cookie: ownerCookie,
							body: { key: keyId, handles: [handle], decision: "approved" },
						})
					).data,
				).toEqual({ decided: [] });
				expect(await run([id])).toEqual([{ id, status: "refused" }]);
				expect(await snapshot()).toEqual(before);
			} finally {
				vi.useRealTimers();
			}
		});

		it("refuses a call another key requested", async () => {
			const otherKey = await createKey(booted.payload, {
				userId: (
					await booted.payload.find({
						collection: "users",
						where: { email: { equals: USER.email } },
					})
				).docs[0]!.id,
				label: "second",
				capabilities: CAPABILITIES,
			});
			const second = createMcpClient(booted, otherKey);
			const tag = await createTag("Bound to its key");
			const { id } = await request(mcp, { collection: "tags", id: tag.id });

			await decide(id, "approved");

			const before = await snapshot();

			expect(await run([id], second)).toEqual([{ id, status: "refused" }]);
			expect(await snapshot()).toEqual(before);
			expect((await run([id]))[0]).toMatchObject({ id, status: "done" });
		});

		it("skips a call the key no longer allows", async () => {
			const key = await createKey(booted.payload, {
				userId: (
					await booted.payload.find({
						collection: "users",
						where: { email: { equals: USER.email } },
					})
				).docs[0]!.id,
				label: "unticked",
				capabilities: CAPABILITIES,
			});
			const unticked = createMcpClient(booted, key);
			const { docs } = await booted.payload.find({
				collection: API_KEYS_SLUG as never,
				where: { label: { equals: "unticked" } },
				overrideAccess: true,
			});
			const untickedId = docs[0]!.id;
			const tag = await createTag("Unticked");
			const { id } = await request(unticked, {
				collection: "tags",
				id: tag.id,
			});
			const [entry] = await list(id, untickedId);

			await send("POST", {
				cookie: ownerCookie,
				body: {
					key: untickedId,
					handles: [entry!.handle],
					decision: "approved",
				},
			});
			await booted.payload.update({
				collection: API_KEYS_SLUG as never,
				id: untickedId,
				data: {
					capabilities: {
						collections: {
							tags: { read: true, delete: false },
							bins: { read: true, delete: true },
						},
					},
				},
				overrideAccess: true,
			});

			const before = await snapshot();

			expect(await run([id], unticked)).toEqual([
				{
					id,
					status: "skipped",
					reason: "This key no longer allows this call.",
				},
			]);
			expect((await snapshot()).state).toEqual(before.state);
		});

		it("skips a call whose document changed since it was requested", async () => {
			const bin = await createBin("Changing");
			const { id } = await request(mcp, { collection: "bins", id: bin.id });

			await decide(id, "approved");
			await booted.payload.update({
				collection: "bins" as never,
				id: bin.id,
				data: { title: "Changed" },
				overrideAccess: true,
			});

			const before = await snapshot();

			expect(await run([id])).toEqual([
				{
					id,
					status: "skipped",
					reason:
						"The document changed since you read it. Read it again before deleting.",
				},
			]);
			expect((await snapshot()).state).toEqual(before.state);
		});

		it("answers each id of a mixed call in order", async () => {
			const [approved, pending, rejected] = await Promise.all(
				["Mixed approved", "Mixed pending", "Mixed rejected"].map(createTag),
			);
			const ids = [];

			for (const tag of [approved!, pending!, rejected!]) {
				// eslint-disable-next-line no-await-in-loop
				ids.push((await request(mcp, { collection: "tags", id: tag.id })).id);
			}

			await decide(ids[0]!, "approved");
			await decide(ids[2]!, "rejected");

			const unknown = "a".repeat(43);

			expect(await run([ids[1]!, unknown, ids[0]!, ids[2]!])).toEqual([
				{ id: ids[1], status: "pending" },
				{ id: unknown, status: "refused" },
				{
					id: ids[0],
					status: "done",
					result: { collection: "tags", id: approved!.id, movedToTrash: false },
				},
				{ id: ids[2], status: "refused" },
			]);
			expect(await exists("tags", pending!.id)).toBeDefined();
			expect(await exists("tags", rejected!.id)).toBeDefined();
		});
	});
});
