import { createPayloadRequest } from "payload";

import { refusal } from "./http.js";
import { findAgentKey, managedMarker } from "../keys/manager.js";
import { isId } from "../protocol/owner.js";
import { handleHash } from "../threads/handle.js";

import type { RunKind } from "../protocol/context.js";
import type { ExchangeResponse } from "../protocol/exchange.js";
import type { PluginSettings, ThreadDoc } from "../turn.js";
import type { PayloadRequest } from "payload";

/** The live conversation a handle names, as the sidecar's requests resolve it. */
export interface ResolvedHandle {
	thread: Pick<ThreadDoc, "agent" | "id"> & { kind: RunKind };
	/** The user the thread acts as. */
	user: ExchangeResponse["user"];
	key: { apiKey: string; expiresAt: string };
}

/**
 * One answer for every refusal of a handle, so a caller learns nothing about
 * which check failed.
 */
export const handleNotFound = (): Response =>
	refusal(404, "No live conversation matches this handle and agent.");

/*
 * Whether the agent's `access` still admits the user of a chat thread. The
 * user is loaded as mcpx loads a key's user, onto a request without headers
 * or session.
 */
const stillAdmitted = async (
	req: PayloadRequest,
	settings: PluginSettings,
	slug: string,
	owner: ExchangeResponse["user"],
): Promise<boolean> => {
	const agent = settings.agents.find((candidate) => candidate.slug === slug);

	if (!agent?.access) {
		return agent !== undefined;
	}

	const { payload } = req;
	const { collection, id } = owner;
	const user = await payload.findByID({
		collection,
		id,
		depth: payload.collections[collection]?.config.auth.depth ?? 0,
		overrideAccess: true,
		disableErrors: true,
	});

	if (!user) {
		return false;
	}

	return await agent.access({
		req: await createPayloadRequest({ payload, user: { ...user, collection } }),
	});
};

/**
 * The thread, user and key of a live handle for `agent`, or `undefined`:
 * the thread must not be archived, its key must be enabled, unexpired and
 * managed for the agent, and the agent's `access` must still admit the user
 * of a chat thread. Never logs the handle.
 */
export const resolveHandle = async (
	req: PayloadRequest,
	settings: PluginSettings,
	handle: string,
	agent: string,
): Promise<ResolvedHandle | undefined> => {
	const { payload } = req;
	const { docs } = await payload.find({
		collection: settings.threads.slug,
		where: { handleHash: { equals: handleHash(handle) } },
		limit: 1,
		depth: 0,
		overrideAccess: true,
		showHiddenFields: true,
		select: { agent: true, kind: true, status: true, createdBy: true },
	});
	const thread = docs[0] as
		| Pick<ThreadDoc, "agent" | "createdBy" | "id" | "kind" | "status">
		| undefined;
	const { userCollection } = settings.mcpx;

	if (
		!thread?.kind ||
		thread.agent !== agent ||
		thread.status === "archived" ||
		thread.createdBy?.relationTo !== userCollection ||
		!isId(thread.createdBy.value)
	) {
		return undefined;
	}

	const user = { collection: userCollection, id: thread.createdBy.value };
	const key = await findAgentKey(payload, settings, {
		userId: user.id,
		agent: thread.agent,
	});

	if (
		!key?.apiKey ||
		!key.enabled ||
		!key.expiresAt ||
		!(Date.parse(key.expiresAt) > Date.now()) ||
		String(key.user) !== String(user.id) ||
		key.managedBy !== managedMarker(thread.agent)
	) {
		return undefined;
	}

	if (
		thread.kind === "chat" &&
		!(await stillAdmitted(req, settings, thread.agent, user))
	) {
		return undefined;
	}

	return {
		thread: { id: thread.id, agent: thread.agent, kind: thread.kind },
		user,
		key: { apiKey: key.apiKey, expiresAt: key.expiresAt },
	};
};
