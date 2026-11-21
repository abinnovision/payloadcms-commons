import { createPayloadRequest } from "payload";

import { handleHash } from "./handle.js";
import { managedMarker } from "../keys/manager.js";
import { isId } from "../protocol/owner.js";

import type { AgentKey } from "../keys/manager.js";
import type { NormalizedOptions } from "../options.js";
import type { RunKind } from "../protocol/context.js";
import type { DefaultDocumentIDType, Payload } from "payload";

/** What resolving a handle reads from the plugin's settings. */
export type ResolveSettings = Pick<
	NormalizedOptions,
	"agents" | "mcpx" | "threads"
>;

/** The live thread a handle names, and the user it acts as. */
export interface LiveThread {
	thread: { id: DefaultDocumentIDType; agent: string; kind: RunKind };
	user: { collection: string; id: number | string };
}

/**
 * The thread of `handle` for `agent`, or `undefined`: it must exist, not be
 * archived, and belong to a user of the mcpx user collection. Never logs
 * the handle.
 */
export const findLiveThread = async (
	payload: Payload,
	settings: ResolveSettings,
	handle: string,
	agent: string,
): Promise<LiveThread | undefined> => {
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
		| undefined
		| {
				id: DefaultDocumentIDType;
				agent?: string;
				kind?: null | RunKind;
				status?: null | string;
				createdBy?: null | { relationTo?: string; value?: unknown };
		  };
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

	return {
		thread: { id: thread.id, agent, kind: thread.kind },
		user: { collection: userCollection, id: thread.createdBy.value },
	};
};

/** Whether the key is the enabled, unexpired managed key of the user and agent. */
export const isLiveKey = (
	key: Pick<AgentKey, "enabled" | "expiresAt" | "managedBy" | "user">,
	user: LiveThread["user"],
	agent: string,
): boolean =>
	key.enabled &&
	key.expiresAt !== undefined &&
	Date.parse(key.expiresAt) > Date.now() &&
	String(key.user) === String(user.id) &&
	key.managedBy === managedMarker(agent);

/**
 * Whether the agent's `access` still admits the user of a chat thread. The
 * user is loaded as mcpx loads a key's user, onto a request without headers
 * or session.
 */
export const stillAdmitted = async (
	payload: Payload,
	settings: ResolveSettings,
	agentSlug: string,
	owner: LiveThread["user"],
): Promise<boolean> => {
	const agent = settings.agents.find(
		(candidate) => candidate.slug === agentSlug,
	);

	if (!agent?.access) {
		return agent !== undefined;
	}

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
