import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
	API_KEYS_SLUG,
	bootPayload,
	enableEditorKey,
	exchange,
	login,
	mcpRpc,
	seed,
	send,
	shutdown,
	THREADS_SLUG,
} from "./helpers/payload.js";
import { INITIAL_DATA_KEY } from "../../src/protocol/exchange.js";
import { handleHash } from "../../src/threads/handle.js";
import { EDITOR, SIDECAR_SECRET } from "../fixtures/config.js";

import type { Booted, Seeded, SeededUser } from "./helpers/payload.js";

interface Started {
	thread: number | string;
	conversationId: string;
	handle: string;
}

describe("exchangeHandler", () => {
	let booted: Booted;
	let seeded: Seeded;

	// Sends a first message and reads the handle the sidecar received.
	const startChat = async (
		user: SeededUser,
		agent = "editor",
	): Promise<Started> => {
		const response = await send(booted, `/api/flue/chat/${agent}`, {
			method: "POST",
			token: user.token,
			body: { message: "Hello", context: { route: "/admin" } },
		});
		const { thread } = (await response.json()) as {
			thread: { id: number | string };
		};
		const row = await booted.payload.findByID({
			collection: THREADS_SLUG,
			id: thread.id,
			overrideAccess: true,
			showHiddenFields: true,
		});
		const conversationId = row["conversationId"] as string;
		const posted = booted.sidecar
			.sends()
			.find((request) => request.path.endsWith(`/${conversationId}`));
		const body = JSON.parse(posted?.body ?? "{}") as {
			initialData: Record<string, { handle: string }>;
		};

		expect(response.status).toBe(200);

		return {
			thread: thread.id,
			conversationId,
			handle: body.initialData[INITIAL_DATA_KEY]!.handle,
		};
	};

	// A signed-in user of its own, for cases that change the user.
	const freshUser = async (
		data: Record<string, unknown> = {},
	): Promise<SeededUser> => {
		const credentials = {
			email: `${randomUUID()}@example.com`,
			password: "fresh-secret",
		};
		const user = await booted.payload.create({
			collection: "users",
			data: { ...credentials, ...data },
			overrideAccess: true,
		});

		return {
			id: user.id,
			token: await login(booted.payload, "users", credentials),
		};
	};

	const archive = (thread: number | string): Promise<Response> =>
		send(booted, `/api/${THREADS_SLUG}/${String(thread)}`, {
			method: "PATCH",
			token: seeded.first.token,
			body: { status: "archived" },
		});

	// A privileged write to the managed key of `user`, the only key such a user has.
	const updateKey = async (
		user: SeededUser,
		data: Record<string, unknown>,
	): Promise<void> => {
		await booted.payload.update({
			collection: API_KEYS_SLUG,
			where: { user: { equals: user.id } },
			data,
			overrideAccess: true,
		});
	};

	beforeAll(async () => {
		booted = await bootPayload("flue-exchange");
		seeded = await seed(booted.payload);
	});

	afterAll(async () => {
		await shutdown(booted);
	});

	it("trades a live handle for a key that authenticates at mcpx with the agent's capabilities", async () => {
		const { thread, handle } = await startChat(seeded.first);
		const response = await exchange(booted, { handle, agent: "editor" });
		const body = (await response.json()) as Record<string, unknown>;
		const { status, body: listed } = await mcpRpc(
			booted,
			body["key"] as string,
			"tools/list",
		);
		const tools = (listed["result"] as { tools: { name: string }[] }).tools.map(
			(tool) => tool.name,
		);

		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(body).toEqual({
			key: expect.any(String),
			mcpPath: "/api/mcpx",
			expiresAt: expect.any(String),
			user: { id: seeded.first.id, collection: "users" },
			thread,
			kind: "chat",
		});
		expect(status).toBe(200);
		expect(tools).toEqual(
			expect.arrayContaining(["patchDocument", "deleteDocument"]),
		);
	});

	it.each([
		["a wrong secret", `Bearer ${SIDECAR_SECRET}x`],
		["no secret", ""],
	])("refuses %s with 401", async (_label, authorization) => {
		const { handle } = await startChat(seeded.first);
		const response = await exchange(
			booted,
			{ handle, agent: "editor" },
			authorization,
		);

		expect(response.status).toBe(401);
		expect(await response.json()).toEqual({ error: expect.any(String) });
	});

	it("refuses the handle for another agent", async () => {
		const { handle } = await startChat(seeded.first);

		expect(
			(await exchange(booted, { handle, agent: "restricted" })).status,
		).toBe(404);
	});

	it("refuses the conversation id in place of the handle", async () => {
		const { conversationId } = await startChat(seeded.first);

		expect(
			(await exchange(booted, { handle: conversationId, agent: "editor" }))
				.status,
		).toBe(404);
	});

	it("refuses a restricted conversation once access no longer admits its user", async () => {
		const user = await freshUser({ agentAccess: true });
		const { handle } = await startChat(user, "restricted");

		expect(
			(await exchange(booted, { handle, agent: "restricted" })).status,
		).toBe(200);

		await booted.payload.update({
			collection: "users",
			id: user.id,
			data: { agentAccess: false },
			overrideAccess: true,
		});

		expect(
			(await exchange(booted, { handle, agent: "restricted" })).status,
		).toBe(404);
	});

	it("refuses the handle of an archived thread", async () => {
		const { thread, handle } = await startChat(seeded.first);
		const archived = await archive(thread);

		// The archive disabled the key; a turn of another thread enables it again.
		await enableEditorKey(booted, seeded.first.id);

		expect(archived.status).toBe(200);
		expect((await exchange(booted, { handle, agent: "editor" })).status).toBe(
			404,
		);
	});

	it("refuses the handle once its key expired", async () => {
		const user = await freshUser();
		const { handle } = await startChat(user);

		await updateKey(user, {
			expiresAt: new Date(Date.now() - 1).toISOString(),
		});

		expect((await exchange(booted, { handle, agent: "editor" })).status).toBe(
			404,
		);
	});

	it("refuses the handle of a thread an admins user owns", async () => {
		// The users and admins rows share an id, so only the collection tells them apart.
		const threadOf = async (
			relationTo: "admins" | "users",
		): Promise<string> => {
			const handle = randomUUID();

			await booted.payload.create({
				collection: THREADS_SLUG,
				data: {
					agent: EDITOR.slug,
					kind: "chat",
					conversationId: randomUUID(),
					handleHash: handleHash(handle),
					createdBy: {
						relationTo,
						value: relationTo === "admins" ? seeded.admin.id : seeded.first.id,
					},
				},
				overrideAccess: true,
			});

			return handle;
		};

		await enableEditorKey(booted, seeded.first.id);

		expect(
			(
				await exchange(booted, {
					handle: await threadOf("users"),
					agent: "editor",
				})
			).status,
		).toBe(200);
		expect(
			(
				await exchange(booted, {
					handle: await threadOf("admins"),
					agent: "editor",
				})
			).status,
		).toBe(404);
	});

	it("answers every refusal with the same status and body", async () => {
		const other = await startChat(seeded.first);
		const archived = await startChat(seeded.first);
		const expiredUser = await freshUser();
		const expired = await startChat(expiredUser);
		const disabledUser = await freshUser();
		const disabled = await startChat(disabledUser);

		await archive(archived.thread);
		await enableEditorKey(booted, seeded.first.id);
		await updateKey(expiredUser, {
			expiresAt: new Date(Date.now() - 1).toISOString(),
		});
		await updateKey(disabledUser, { enabled: false });

		const refusals = await Promise.all(
			[
				{ handle: randomUUID(), agent: "editor" },
				{ handle: other.handle, agent: "restricted" },
				{ handle: archived.handle, agent: "editor" },
				{ handle: expired.handle, agent: "editor" },
				{ handle: disabled.handle, agent: "editor" },
			].map(async (body) => {
				const response = await exchange(booted, body);

				return { status: response.status, body: await response.text() };
			}),
		);

		expect(refusals[0]?.status).toBe(404);
		expect(refusals).toEqual(refusals.map(() => refusals[0]));
	});

	it("refuses the handle once its user logged out", async () => {
		const user = await freshUser();
		const { handle } = await startChat(user);

		const loggedOut = await send(booted, "/api/users/logout", {
			method: "POST",
			token: user.token,
		});

		expect(loggedOut.status).toBe(200);
		expect((await exchange(booted, { handle, agent: "editor" })).status).toBe(
			404,
		);
	});
});
