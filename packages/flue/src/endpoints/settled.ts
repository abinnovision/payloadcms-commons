import {
	endpointHandler,
	readJson,
	refusal,
	requireJson,
	secretMatches,
} from "./http.js";
import { isRecord } from "../protocol/guards.js";
import { createSidecarClient, SidecarError } from "../sidecar/client.js";
import { applyReconciliation, reconciliationOf } from "../sidecar/observe.js";
import { internalRequest } from "../turn.js";

import type { SettledRequest } from "../protocol/settled.js";
import type { PluginSettings, ThreadDoc } from "../turn.js";
import type { PayloadHandler } from "payload";

const BODY_MAX = 4 * 1024;
const FIELD_MAX = 256;

const isField = (value: unknown): value is string =>
	typeof value === "string" && value.length > 0 && value.length <= FIELD_MAX;

const isSettledRequest = (value: unknown): value is SettledRequest =>
	isRecord(value) &&
	isField(value["conversation"]) &&
	isField(value["submissionId"]);

const noContent = (): Response => new Response(null, { status: 204 });

/**
 * `POST {base}/settled`: the sidecar reports that a submission of a
 * conversation settled. Only the sidecar calls it, authenticated by the
 * shared secret. The report only names the thread; its status and title come
 * from Flue's history. Answers 409 while the thread has not recorded the
 * submission, so the sidecar retries.
 */
export const settledHandler = (settings: PluginSettings): PayloadHandler =>
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

		if (!isSettledRequest(body)) {
			return refusal(
				400,
				"The body must carry a conversation and a submissionId.",
			);
		}

		const { payload } = req;
		const { docs } = await payload.find({
			collection: settings.threads.slug,
			where: { conversationId: { equals: body.conversation } },
			limit: 1,
			depth: 0,
			overrideAccess: true,
			showHiddenFields: true,
			select: {
				agent: true,
				kind: true,
				status: true,
				conversationId: true,
				lastSubmissionId: true,
				agentTitle: true,
			},
		});
		const thread = docs[0] as ThreadDoc | undefined;

		if (!thread?.conversationId || thread.status === "archived") {
			return noContent();
		}

		if (thread.lastSubmissionId !== body.submissionId) {
			return refusal(409, "The thread has not recorded this submission.");
		}

		try {
			const read = await createSidecarClient(settings.sidecar).history(
				thread.agent,
				thread.conversationId,
			);

			if (read?.history) {
				await applyReconciliation(
					await internalRequest(payload, null, {
						agent: thread.agent,
						thread: thread.id,
						kind: thread.kind ?? "chat",
					}),
					settings,
					thread.id,
					reconciliationOf(thread, read.history),
				);
			}
		} catch (error) {
			if (!(error instanceof SidecarError)) {
				throw error;
			}

			payload.logger.error({
				err: error,
				msg: "[payloadcms-flue] Could not read the history of a settled submission.",
			});
		}

		return noContent();
	});
