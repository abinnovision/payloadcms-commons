import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
	bootPayload,
	liveToken,
	mcpRpc,
	seed,
	send,
	shutdown,
} from "./helpers/payload.js";
import { EDITOR, RESTRICTED } from "../fixtures/config.js";

import type { Booted, Seeded } from "./helpers/payload.js";

interface ToolResult {
	content?: { type: string; text: string }[];
}

/*
 * mcpx and flue on one Payload instance: an agent token authenticates at
 * mcpx, and mcpx's approval flow runs on the token's thread.
 */
describe("an agent token at mcpx", () => {
	let booted: Booted;
	let seeded: Seeded;

	const toolNames = async (key: string): Promise<string[]> => {
		const { body } = await mcpRpc(booted, key, "tools/list");
		const result = body["result"] as { tools: { name: string }[] };

		return result.tools.map((tool) => tool.name);
	};

	const callTool = async (
		key: string,
		name: string,
		args: Record<string, unknown>,
	): Promise<Record<string, unknown>> => {
		const { body } = await mcpRpc(booted, key, "tools/call", {
			name,
			arguments: args,
		});
		const text = (body["result"] as ToolResult).content?.[0]?.text ?? "{}";

		return JSON.parse(text) as Record<string, unknown>;
	};

	beforeAll(async () => {
		booted = await bootPayload("flue-smoke");
		seeded = await seed(booted.payload);
	});

	afterAll(async () => {
		await shutdown(booted);
	});

	it("lists only the tools the agent's capabilities allow", async () => {
		const editor = await liveToken(booted, seeded.first.id, 1, EDITOR.slug);
		const restricted = await liveToken(
			booted,
			seeded.first.id,
			2,
			RESTRICTED.slug,
		);

		expect(await toolNames(editor)).toEqual([
			"listCapabilities",
			"describeSchema",
			"findDocuments",
			"getDocument",
			"findVersions",
			"patchDocument",
			"createDocument",
			"duplicateDocument",
			"validateDocument",
			"deleteDocument",
			"runConfirmed",
		]);
		expect(await toolNames(restricted)).toEqual([
			"listCapabilities",
			"describeSchema",
			"findDocuments",
			"getDocument",
			"findVersions",
		]);
	});

	it("runs a delete its user approved, once, across a token rotation", async () => {
		const apiKey = await liveToken(booted, seeded.first.id, 3);
		const post = await booted.payload.create({
			collection: "posts",
			data: { title: "Obsolete" },
			overrideAccess: true,
		});

		const requested = await callTool(apiKey, "deleteDocument", {
			collection: "posts",
			id: post.id,
		});
		const { id: confirmationId } = requested["confirmation"] as { id: string };

		expect(requested["confirmation"]).toMatchObject({
			principal: "flue-thread:3",
		});
		expect(requested["confirmation"]).not.toHaveProperty("url");

		const query = new URLSearchParams({
			principal: "flue-thread:3",
			confirmation: confirmationId,
		});
		const listed = await send(
			booted,
			`/api/mcpx/confirmations?${query.toString()}`,
			{ token: seeded.first.token },
		);
		const { confirmations } = (await listed.json()) as {
			confirmations: { handle: string; highlighted: boolean }[];
		};
		const handle = confirmations.find((entry) => entry.highlighted)?.handle;

		expect(listed.status).toBe(200);
		expect(handle).toEqual(expect.any(String));

		const decided = await send(booted, "/api/mcpx/confirmations", {
			method: "POST",
			token: seeded.first.token,
			body: {
				principal: "flue-thread:3",
				handles: [handle],
				decision: "approved",
			},
		});

		expect(await decided.json()).toEqual({ decided: [handle] });

		const rotated = await liveToken(booted, seeded.first.id, 3);

		expect(
			await callTool(rotated, "runConfirmed", { ids: [confirmationId] }),
		).toEqual({
			results: [
				{
					id: confirmationId,
					status: "done",
					result: { collection: "posts", id: post.id, movedToTrash: true },
				},
			],
		});

		const trashed = await booted.payload.findByID({
			collection: "posts",
			id: post.id,
			trash: true,
			overrideAccess: true,
		});

		expect(trashed["deletedAt"]).toEqual(expect.any(String));
		expect(
			await callTool(apiKey, "runConfirmed", { ids: [confirmationId] }),
		).toEqual({ results: [{ id: confirmationId, status: "refused" }] });
	});

	it("never runs another thread's approved call", async () => {
		const own = await liveToken(booted, seeded.first.id, 4);
		const other = await liveToken(booted, seeded.first.id, 5);
		const post = await booted.payload.create({
			collection: "posts",
			data: { title: "Kept" },
			overrideAccess: true,
		});
		const requested = await callTool(own, "deleteDocument", {
			collection: "posts",
			id: post.id,
		});
		const { id: confirmationId } = requested["confirmation"] as { id: string };

		expect(
			await callTool(other, "runConfirmed", { ids: [confirmationId] }),
		).toEqual({ results: [{ id: confirmationId, status: "refused" }] });
	});
});
