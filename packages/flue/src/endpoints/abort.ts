import {
	endpointHandler,
	isDocumentId,
	json,
	refusal,
	requireJson,
	requireUser,
} from "./http.js";
import { setAgentKeyEnabled } from "../keys/manager.js";
import { isOwner } from "../protocol/owner.js";
import { createSidecarClient, SidecarError } from "../sidecar/client.js";
import { findThread } from "../turn.js";

import type { PluginSettings } from "../turn.js";
import type { PayloadHandler } from "payload";

/**
 * `POST {base}/c/:thread/abort`: stops the run of a thread the signed-in
 * user owns. Stopping a running thread disables the key of its user and
 * agent until the next turn. The body is not read.
 */
export const abortHandler = (settings: PluginSettings): PayloadHandler =>
	endpointHandler(async (req) => {
		const { userCollection } = settings.mcpx;
		const user = requireUser(req, userCollection);

		if (user instanceof Response) {
			return user;
		}

		const notJson = requireJson(req);

		if (notJson) {
			return notJson;
		}

		const id = req.routeParams?.["thread"];
		const thread = isDocumentId(req, id)
			? await findThread(req.payload, settings, id, req)
			: null;

		if (
			!thread?.conversationId ||
			!isOwner(thread.createdBy, user, userCollection)
		) {
			return refusal(404, "The thread does not exist.");
		}

		let aborted: boolean;

		try {
			({ aborted } = await createSidecarClient(settings.sidecar).abort(
				thread.agent,
				thread.conversationId,
			));
		} catch (error) {
			if (!(error instanceof SidecarError)) {
				throw error;
			}

			// A conversation Flue has not seen has no run to stop.
			if (error.status !== 404) {
				return refusal(502, "The agent sidecar could not be reached.");
			}

			aborted = false;
		}

		if (thread.status === "running") {
			await setAgentKeyEnabled(req.payload, settings, {
				userId: user.id,
				agent: thread.agent,
				enabled: false,
				req,
			});

			/*
			 * A confirmed abort settles the run; the stream's settlement may
			 * never be read. Conditional in the database, so an archive or
			 * settlement since the read stands.
			 */
			if (aborted) {
				await req.payload.db.updateOne({
					collection: settings.threads.slug,
					where: {
						and: [
							{ id: { equals: thread.id } },
							{ status: { equals: "running" } },
						],
					},
					data: { status: "idle" },
					options: { atomic: true },
					req,
				});
			}
		}

		return json(200, { aborted });
	});
