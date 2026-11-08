import { createPayloadRequest } from "payload";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
	bootPayload,
	keySettings,
	mcpRpc,
	seed,
	send,
	shutdown,
} from "./helpers/payload.js";
import { ensureAgentKey, findAgentKey } from "../../src/keys/manager.js";
import { EDITOR, RESTRICTED } from "../fixtures/config.js";

import type { Booted, Seeded } from "./helpers/payload.js";
import type { FlueAgentConfig } from "../../src/index.js";

interface ToolResult {
	content?: { type: string; text: string }[];
}

/*
 * mcpx and flue on one Payload instance: a key flue manages authenticates at
 * mcpx, and mcpx's approval flow runs on it.
 */
describe("a managed key at mcpx", () => {
	let booted: Booted;
	let seeded: Seeded;

	const managedKey = async (
		agent: FlueAgentConfig,
	): Promise<{ id: number | string; apiKey: string }> => {
		const settings = keySettings(booted.payload);

		await ensureAgentKey(booted.payload, settings, {
			userId: seeded.first.id,
			agent,
			req: await createPayloadRequest({ payload: booted.payload }),
		});

		const key = await findAgentKey(booted.payload, settings, {
			userId: seeded.first.id,
			agent: agent.slug,
		});

		if (key?.apiKey === undefined) {
			throw new Error("The managed key has no plaintext.");
		}

		return { id: key.id, apiKey: key.apiKey };
	};

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
		const editor = await managedKey(EDITOR);
		const restricted = await managedKey(RESTRICTED);

		expect(await toolNames(editor.apiKey)).toEqual([
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
		expect(await toolNames(restricted.apiKey)).toEqual([
			"listCapabilities",
			"describeSchema",
			"findDocuments",
			"getDocument",
			"findVersions",
		]);
	});

	it("runs a delete its user approved, once", async () => {
		const { id: keyId, apiKey } = await managedKey(EDITOR);
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

		const query = new URLSearchParams({
			key: String(keyId),
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
			body: { key: keyId, handles: [handle], decision: "approved" },
		});

		expect(await decided.json()).toEqual({ decided: [handle] });

		expect(
			await callTool(apiKey, "runConfirmed", { ids: [confirmationId] }),
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
});
