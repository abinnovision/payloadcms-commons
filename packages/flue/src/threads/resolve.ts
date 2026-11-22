import { createPayloadRequest } from "payload";

import { handleHash } from "./handle.js";
import { isId } from "../protocol/owner.js";
import { liveWindow } from "../tokens/store.js";

import type { NormalizedOptions } from "../options.js";
import type { RunKind } from "../protocol/context.js";
import type { LiveWindow } from "../tokens/store.js";
import type { FlueAgentConfig } from "../types.js";
import type { DefaultDocumentIDType, Payload, PayloadRequest } from "payload";

type TypedUser = NonNullable<PayloadRequest["user"]>;

/** What resolving a handle reads from the plugin's settings. */
export type ResolveSettings = Pick<
	NormalizedOptions,
	"agents" | "mcpx" | "threads"
>;

interface LiveUser {
	collection: string;
	id: number | string;
}

/**
 * Whether the agent's `access` admits `user`, evaluated on a request built
 * for that user without headers or session.
 */
export const admits = async (
	payload: Payload,
	agent: FlueAgentConfig,
	user: TypedUser,
): Promise<boolean> =>
	!agent.access ||
	(await agent.access({ req: await createPayloadRequest({ payload, user }) }));

/*
 * Whether the agent's `access` still admits the user of a chat thread. The
 * user is loaded at the user collection's `auth.depth`.
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

	return await admits(payload, agent, { ...user, collection });
};

/**
 * The live thread `handle` names for `agent`, the user it acts as and the
 * live window, or `undefined`. The thread must exist, not be
 * archived and belong to a user of the mcpx user collection; its live window
 * must be open; and the agent's `access` must still admit the user of a chat
 * thread. Never logs the handle.
 */
export const resolveHandle = async (
	payload: Payload,
	settings: ResolveSettings,
	handle: string,
	agent: string,
): Promise<
	| undefined
	| {
			thread: { id: DefaultDocumentIDType; agent: string; kind: RunKind };
			user: LiveUser;
			live: LiveWindow;
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
	const live = await liveWindow(payload, {
		user: user.id,
		thread: thread.id,
	});

	if (
		live === undefined ||
		(thread.kind === "chat" &&
			!(await stillAdmitted(payload, settings, agent, user)))
	) {
		return undefined;
	}

	return {
		thread: { id: thread.id, agent, kind: thread.kind },
		user,
		live,
	};
};
