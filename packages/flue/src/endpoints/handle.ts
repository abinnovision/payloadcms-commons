import { refusal } from "./http.js";
import { findAgentKey } from "../keys/manager.js";
import {
	findLiveThread,
	isLiveKey,
	stillAdmitted,
} from "../threads/resolve.js";

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
	const live = await findLiveThread(payload, settings, handle, agent);

	if (!live) {
		return undefined;
	}

	const { thread, user } = live;
	const key = await findAgentKey(payload, settings, {
		userId: user.id,
		agent: thread.agent,
	});

	if (
		!key?.apiKey ||
		key.expiresAt === undefined ||
		!isLiveKey(key, user, thread.agent)
	) {
		return undefined;
	}

	if (
		thread.kind === "chat" &&
		!(await stillAdmitted(payload, settings, thread.agent, user))
	) {
		return undefined;
	}

	return {
		thread,
		user,
		key: { apiKey: key.apiKey, expiresAt: key.expiresAt },
	};
};
