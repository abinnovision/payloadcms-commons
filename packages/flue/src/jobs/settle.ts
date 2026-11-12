import { createSidecarClient, SidecarError } from "../sidecar/client.js";
import { applyReconciliation, reconciliationOf } from "../sidecar/observe.js";
import { findThread, internalRequest } from "../turn.js";

import type { FlueHistory, FlueSettlement } from "../protocol/events.js";
import type { PluginSettings, ThreadDoc } from "../turn.js";
import type { DefaultDocumentIDType, PayloadRequest } from "payload";

const POLL_MS = 5_000;

/** The settlement of `submissionId` in a history snapshot, if it settled. */
export const settlementOf = (
	history: Pick<FlueHistory, "settlements">,
	submissionId: string,
): FlueSettlement | undefined =>
	history.settlements.find(
		(settlement) => settlement.submissionId === submissionId,
	);

/** How long to sleep before the next poll: one interval, cut at the deadline. */
export const nextSleep = (
	deadline: number,
	now: number,
	pollMs: number,
): number => Math.max(0, Math.min(pollMs, deadline - now));

/**
 * Polls the thread's history until `submissionId` settles, and settles the
 * row through the same reconciliation as the sidecar's report. Returns the
 * settlement, or `null` once the row is deleted, archived or runs a newer
 * submission. Throws when the conversation is gone or `maxWaitMs` passes;
 * the run itself is left alone.
 */
export const awaitSettlement = async (
	req: PayloadRequest,
	settings: PluginSettings,
	threadId: DefaultDocumentIDType,
	submissionId: string,
	{ maxWaitMs }: { maxWaitMs: number },
): Promise<FlueSettlement | null> => {
	const { payload } = req;
	const client = createSidecarClient(settings.sidecar);
	const deadline = Date.now() + maxWaitMs;
	const label = `flue-dispatch run ${submissionId} of thread ${String(threadId)}`;

	const reconcile = async (
		thread: ThreadDoc,
		history: FlueHistory,
	): Promise<void> => {
		await applyReconciliation(
			await internalRequest(payload, null, {
				agent: thread.agent,
				thread: thread.id,
				kind: thread.kind ?? "chat",
			}),
			settings,
			thread.id,
			reconciliationOf(thread, history),
		);
	};

	// `undefined` when the conversation is gone, `null` when the read failed.
	const read = async (
		thread: ThreadDoc,
	): Promise<FlueHistory | null | undefined> => {
		if (!thread.conversationId) {
			return undefined;
		}

		try {
			return (await client.history(thread.agent, thread.conversationId))
				?.history;
		} catch (error) {
			if (!(error instanceof SidecarError)) {
				throw error;
			}

			payload.logger.warn({
				err: error,
				msg: `[payloadcms-flue] Could not read the history of ${label}.`,
			});

			return null;
		}
	};

	const poll = async (): Promise<FlueSettlement | null> => {
		const thread = await findThread(payload, settings, threadId, req);

		if (!thread) {
			payload.logger.warn(
				`[payloadcms-flue] The thread of ${label} was deleted before the run settled.`,
			);

			return null;
		}

		const history = await read(thread);

		if (history === undefined) {
			throw new Error(
				`[payloadcms-flue] The conversation of ${label} is gone.`,
			);
		}

		if (history) {
			const settlement = settlementOf(history, submissionId);

			if (settlement) {
				await reconcile(thread, history);

				return settlement;
			}

			if (
				thread.status === "archived" ||
				thread.lastSubmissionId !== submissionId
			) {
				return null;
			}

			await reconcile(thread, history);
		}

		const now = Date.now();

		if (now >= deadline) {
			throw new Error(
				`[payloadcms-flue] ${label} did not settle within ${String(maxWaitMs)} ms.`,
			);
		}

		await new Promise((resolve) => {
			setTimeout(resolve, nextSleep(deadline, now, POLL_MS));
		});

		return await poll();
	};

	return await poll();
};
