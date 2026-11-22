import {
	endpointHandler,
	json,
	readJson,
	refusal,
	requireJson,
	secretMatches,
} from "./http.js";
import { isRecord } from "../protocol/guards.js";
import { resolveHandle } from "../threads/resolve.js";
import { mintToken } from "../tokens/store.js";

import type { ExchangeResponse } from "../protocol/exchange.js";
import type { PluginSettings } from "../turn.js";
import type { PayloadHandler } from "payload";

const BODY_MAX = 4 * 1024;

/**
 * `POST {base}/exchange`: trades a live conversation handle for a fresh
 * token of its thread, valid until `tokenTtlMs` from now or the thread's
 * live window closes, whichever comes first. Only the sidecar calls it,
 * authenticated by the shared secret; the session is ignored. Never logs the
 * token or the handle.
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
		);

		// One answer for every refusal, so a caller learns nothing about which check failed.
		if (!resolved) {
			return refusal(
				404,
				"No live conversation matches this handle and agent.",
			);
		}

		const { thread, user, live } = resolved;
		const { token, exp } = await mintToken(
			payload,
			{
				user: user.id,
				thread: thread.id,
				agent,
				kind: thread.kind,
				gen: live.gen,
			},
			settings.tokenTtlMs,
			live.exp,
		);
		const response: ExchangeResponse = {
			key: token,
			mcpPath: settings.mcpx.mcpPath,
			expiresAt: new Date(exp).toISOString(),
			user,
			thread: thread.id,
			kind: thread.kind,
		};

		return json(200, response);
	});
