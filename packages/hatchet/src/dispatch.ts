import type { HatchetClient, JsonObject } from "@hatchet-dev/typescript-sdk";
import type { Job, Payload } from "payload";

/**
 * Input of every Hatchet run that executes a Payload job.
 */
export interface JobRunInput extends JsonObject {
	jobId: string;
	queue: string;
	slug: string;
	concurrencyKey: string;
}

/**
 * A job with the plugin's fields.
 */
export type HatchetJob = Job & {
	hatchetRunId?: null | string;
	hatchetScheduledId?: null | string;
	hatchetDispatchedAt?: null | string;
	hatchetHeartbeatAt?: null | string;
};

/**
 * Hands a Payload job to Hatchet. Never throws.
 */
export type Dispatch = (job: HatchetJob) => Promise<void>;

export interface Dispatcher {
	dispatch: Dispatch;

	/**
	 * Deletes a scheduled run. Never throws.
	 */
	unschedule: (scheduledId: string) => Promise<void>;
}

export const defaultTaskName = (queue: string): string => `payload-${queue}`;

export const defaultDispatchTimeoutMs = 2000;

class HatchetTimeoutError extends Error {}

/**
 * Creates the dispatch functions. The client is created on first use, so an
 * unreachable Hatchet cannot break Payload boot. Every Hatchet call is bounded
 * by `timeoutMs`. Failures are logged and left to the worker's maintenance
 * task, which re-dispatches stale jobs.
 */
export const createDispatch = (args: {
	payload: Payload;
	client: () => HatchetClient;
	taskName: (queue: string) => string;
	timeoutMs: number;
}): Dispatcher => {
	const { logger } = args.payload;
	let hatchet: HatchetClient | undefined;

	const bounded = async <T>(call: Promise<T>): Promise<T> => {
		let timer: NodeJS.Timeout | undefined;

		try {
			return await Promise.race([
				call,
				new Promise<never>((_resolve, reject) => {
					timer = setTimeout(() => {
						reject(
							new HatchetTimeoutError(
								`Hatchet did not answer within ${String(args.timeoutMs)}ms.`,
							),
						);
					}, args.timeoutMs);
				}),
			]);
		} finally {
			clearTimeout(timer);
		}
	};

	const unschedule = async (scheduledId: string): Promise<void> => {
		try {
			hatchet ??= args.client();
			await bounded(hatchet.schedules.delete(scheduledId));
		} catch (err) {
			logger.warn({
				err,
				msg: `Failed to delete Hatchet scheduled run ${scheduledId}.`,
			});
		}
	};

	const dispatch: Dispatch = async (job) => {
		const queue = job.queue ?? "default";
		const slug = job.taskSlug ?? job.workflowSlug ?? "";
		const input: JobRunInput = {
			jobId: String(job.id),
			queue,
			slug,
			concurrencyKey: job.concurrencyKey ?? `job:${String(job.id)}`,
		};
		const name = args.taskName(queue);
		const additionalMetadata = { payloadJobId: input.jobId, slug };
		const waitUntil = job.waitUntil ? new Date(job.waitUntil) : undefined;
		const triggerAt =
			waitUntil && waitUntil.getTime() > Date.now() ? waitUntil : undefined;

		// A failed attempt is recorded too, so maintenance retries it after the stale window.
		let data: Partial<HatchetJob> = {
			hatchetDispatchedAt: new Date().toISOString(),
		};

		try {
			hatchet ??= args.client();

			// A stale booked run would only find the job done or not due yet.
			if (job.hatchetScheduledId) {
				await unschedule(job.hatchetScheduledId);
			}

			// Maintenance measures staleness from here, so a scheduled run counts from its start.
			if (triggerAt) {
				const scheduled = await bounded(
					hatchet.schedules.create(name, {
						triggerAt,
						input,
						additionalMetadata,
					}),
				);
				data = {
					hatchetDispatchedAt: triggerAt.toISOString(),
					hatchetRunId: null,
					hatchetScheduledId: scheduled.metadata.id,
				};
			} else {
				const runId = await bounded(
					hatchet
						.runNoWait(name, input, { additionalMetadata })
						.then((ref) => ref.runId),
				);
				data = {
					hatchetDispatchedAt: new Date().toISOString(),
					hatchetRunId: runId,
					hatchetScheduledId: null,
				};
			}
		} catch (err) {
			const log = err instanceof HatchetTimeoutError ? "warn" : "error";

			logger[log]({
				err,
				msg: `Failed to dispatch Payload job ${input.jobId} to Hatchet.`,
			});
		}

		try {
			await args.payload.db.updateJobs({
				where: { id: { equals: job.id } },
				data,
				returning: false,
			});
		} catch (err) {
			logger.error({
				err,
				msg: `Failed to record the dispatch of Payload job ${input.jobId}.`,
			});
		}
	};

	return { dispatch, unschedule };
};
