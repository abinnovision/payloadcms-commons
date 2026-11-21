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

interface LiveUser {
	collection: string;
	id: number | string;
}

type KeyView = Pick<AgentKey, "enabled" | "expiresAt" | "managedBy" | "user">;

/*
 * Whether the agent's `access` still admits the user of a chat thread. The
 * user is loaded as mcpx loads a key's user, onto a request without headers
 * or session.
 */
const stillAdmitted = async (
	payload: Payload,
	settings: ResolveSettings,
	agentSlug: string,
	{ collection, id }: LiveUser,
): Promise<boolean> => {
	const agent = settings.agents.find(
		(candidate) => candidate.slug === agentSlug,
	);

	if (!agent?.access) {
		return agent !== undefined;
	}

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
 * The live thread `handle` names for `agent`, the user it acts as and the
 * key `keyOf` finds for that user, or `undefined`. The thread must exist,
 * not be archived and belong to a user of the mcpx user collection; the key
 * must be the enabled, unexpired managed key of the user and agent; and the
 * agent's `access` must still admit the user of a chat thread. Never logs
 * the handle.
 */
export const resolveHandle = async <K extends KeyView>(
	payload: Payload,
	settings: ResolveSettings,
	handle: string,
	agent: string,
	keyOf: (user: LiveUser) => Promise<K | undefined>,
): Promise<
	| undefined
	| {
			thread: { id: DefaultDocumentIDType; agent: string; kind: RunKind };
			user: LiveUser;
			key: K & { expiresAt: string };
	  }
> => {
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

	const user = { collection: userCollection, id: thread.createdBy.value };
	const key = await keyOf(user);
	const { expiresAt } = key ?? {};

	if (
		!key?.enabled ||
		expiresAt === undefined ||
		!(Date.parse(expiresAt) > Date.now()) ||
		String(key.user) !== String(user.id) ||
		key.managedBy !== managedMarker(agent) ||
		(thread.kind === "chat" &&
			!(await stillAdmitted(payload, settings, agent, user)))
	) {
		return undefined;
	}

	return {
		thread: { id: thread.id, agent, kind: thread.kind },
		user,
		key: { ...key, expiresAt },
	};
};
