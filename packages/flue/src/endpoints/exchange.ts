import { createPayloadRequest } from "payload";

import {
	endpointHandler,
	json,
	readJson,
	refusal,
	requireJson,
	secretMatches,
} from "./http.js";
import { findAgentKey, managedMarker } from "../keys/manager.js";
import { isRecord } from "../protocol/guards.js";
import { isId } from "../protocol/owner.js";
import { handleHash } from "../threads/handle.js";

import type { ExchangeResponse } from "../protocol/exchange.js";
import type { PluginSettings, ThreadDoc } from "../turn.js";
import type { PayloadHandler, PayloadRequest } from "payload";

const BODY_MAX = 4 * 1024;

// One answer for every refusal, so a caller learns nothing about which check failed.
const notFound = (): Response =>
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
 * `POST {base}/exchange`: trades a live conversation handle for its mcpx
 * key. Only the sidecar calls it, authenticated by the shared secret; the
 * session is ignored. Never logs the key or the handle.
 */
export const exchangeHandler = (settings: PluginSettings): PayloadHandler =>
	endpointHandler(async (req) => {
		if (
			!secretMatches(req.headers.get("authorization"), settings.sidecar.secret)
		) {
			return refusal(401, "The sidecar secret does not match.");
		}

		const notJson = requireJson(req);

		if (notJson) {
			return notJson;
		}

		const body = await readJson(req, BODY_MAX);

		if (body instanceof Response) {
			return body;
		}

		if (
			!isRecord(body) ||
			typeof body["handle"] !== "string" ||
			body["handle"] === "" ||
			typeof body["agent"] !== "string"
		) {
			return refusal(400, "The body must carry a handle and an agent.");
		}

		const { payload } = req;
		const { docs } = await payload.find({
			collection: settings.threads.slug,
			where: { handleHash: { equals: handleHash(body["handle"]) } },
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
			thread.agent !== body["agent"] ||
			thread.status === "archived" ||
			thread.createdBy?.relationTo !== userCollection ||
			!isId(thread.createdBy.value)
		) {
			return notFound();
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
			return notFound();
		}

		if (
			thread.kind === "chat" &&
			!(await stillAdmitted(req, settings, thread.agent, user))
		) {
			return notFound();
		}

		const response: ExchangeResponse = {
			key: key.apiKey,
			mcpPath: settings.mcpx.mcpPath,
			expiresAt: key.expiresAt,
			user,
			thread: thread.id,
			kind: thread.kind,
		};

		return json(200, response);
	});
