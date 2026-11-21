import {
	endpointHandler,
	json,
	readJson,
	refusal,
	requireJson,
	secretMatches,
} from "./http.js";
import { findAgentKey } from "../keys/manager.js";
import { isRecord } from "../protocol/guards.js";
import { resolveHandle } from "../threads/resolve.js";

import type { ExchangeResponse } from "../protocol/exchange.js";
import type { PluginSettings } from "../turn.js";
import type { PayloadHandler } from "payload";

const BODY_MAX = 4 * 1024;

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
		const agent = body["agent"];
		const resolved = await resolveHandle(
			payload,
			settings,
			body["handle"],
			agent,
			async (user) =>
				await findAgentKey(payload, settings, { userId: user.id, agent }),
		);

		const apiKey = resolved?.key.apiKey;

		// One answer for every refusal, so a caller learns nothing about which check failed.
		if (!resolved || !apiKey) {
			return refusal(
				404,
				"No live conversation matches this handle and agent.",
			);
		}

		const { thread, user, key } = resolved;
		const response: ExchangeResponse = {
			key: apiKey,
			mcpPath: settings.mcpx.mcpPath,
			expiresAt: key.expiresAt,
			user,
			thread: thread.id,
			kind: thread.kind,
		};

		return json(200, response);
	});
