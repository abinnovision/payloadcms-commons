import {
	APIContracts,
	ConcurrencyLimitStrategy,
	HatchetClient,
} from "@hatchet-dev/typescript-sdk";
import { setTimeout } from "node:timers/promises";
import { getPayload } from "payload";

import { runJob } from "./run-job.js";
import {
	createDispatch,
	defaultDispatchTimeoutMs,
	defaultTaskName,
} from "../dispatch.js";

import type { RunJobOutput } from "./run-job.js";
import type { HatchetJob, JobRunInput } from "../dispatch.js";
import type { CreateWorkerOpts, Worker } from "@hatchet-dev/typescript-sdk";
import type { InitOptions, Payload } from "payload";

export interface HatchetWorkerOptions {
	/**
	 * A booted Payload instance, e.g. `await getPayload({ config })`.
	 */
	payload: Payload;

	/**
	 * Defaults to `HatchetClient.init()`.
	 */
	hatchet?: HatchetClient | undefined;

	/**
	 * Payload queues this worker executes.
	 */
	queues: string[];

	/**
	 * Worker name. Defaults to `"payload"`.
	 */
	name?: string | undefined;

	/**
	 * Concurrent runs on this worker. Defaults to Hatchet's default.
	 */
	slots?: number | undefined;

	/**
	 * Whether the worker stops itself and exits the process on SIGTERM and
	 * SIGINT. Defaults to `true`. Pass `false` when the host process owns
	 * shutdown, e.g. inside a Next.js server, and call `worker.stop()` instead.
	 */
	handleKill?: boolean | undefined;

	/**
	 * Must match the plugin's `taskName`. Defaults to `payload-${queue}`.
	 */
	taskName?: ((queue: string) => string) | undefined;

	/**
	 * Cron task that handles Payload schedules and re-dispatches stale jobs.
	 * Covers all queues. Running it on several workers is harmless; disable it
	 * with `false`.
	 */
	maintenance?:
		| {
				/**
				 * Defaults to every five minutes.
				 */
				cron?: string | undefined;

				/**
				 * Time since the last dispatch or heartbeat after which a job counts as
				 * lost. Defaults to five minutes.
				 */
				staleAfterMs?: number | undefined;
		  }
		| false
		| undefined;

	/**
	 * Interval of the heartbeat that keeps a running job's Hatchet timeout
	 * alive. Defaults to 20 seconds.
	 */
	heartbeatMs?: number | undefined;

	/**
	 * Longest a job may run, in milliseconds. A job that runs longer is
	 * cancelled in Payload and its run fails without a retry. Defaults to
	 * unlimited.
	 */
	maxDurationMs?: number | undefined;
}

const STALE_LIMIT = 100;

const { QUEUED, RUNNING } = APIContracts.V1TaskStatus;

const queueing = (expression: string) => ({
	expression,
	maxRuns: 1,
	limitStrategy: ConcurrencyLimitStrategy.GROUP_ROUND_ROBIN,
});

/**
 * Creates the Hatchet worker that executes Payload jobs. Start it with
 * `await worker.start()`.
 */
export const createHatchetWorker = async (
	options: HatchetWorkerOptions,
): Promise<Worker> => {
	const { payload, queues } = options;
	const hatchet = options.hatchet ?? HatchetClient.init();
	const heartbeatMs = options.heartbeatMs ?? 20_000;
	const taskName = options.taskName ?? defaultTaskName;
	const { dispatch } = createDispatch({
		payload,
		client: () => hatchet,
		taskName,
		timeoutMs: defaultDispatchTimeoutMs,
	});

	const workflows: NonNullable<CreateWorkerOpts["workflows"]> = queues.map(
		(queue) =>
			hatchet.task<JobRunInput, RunJobOutput>({
				name: taskName(queue),
				executionTimeout: "60s",
				/*
				 * Covers worker crashes and infrastructure errors only; Payload owns
				 * job retries. Retry n waits min(factor^n, maxSeconds) seconds, with no
				 * initial delay: 2, 4, 8, 16, 32 and 60 seconds, 122 in total. A crashed
				 * attempt's claim is released once its heartbeat is older than three
				 * heartbeats, 60 seconds by default, so the later retries get past it.
				 */
				retries: 6,
				backoff: { factor: 2, maxSeconds: 60 },
				concurrency: [
					queueing("input.jobId"),
					queueing("input.concurrencyKey"),
				],
				fn: (input, ctx) =>
					runJob({
						payload,
						hatchet,
						dispatch,
						input,
						ctx,
						heartbeatMs,
						maxDurationMs: options.maxDurationMs,
					}),
			}),
	);

	if (options.maintenance !== false) {
		const cron = options.maintenance?.cron ?? "*/5 * * * *";
		const staleAfterMs = options.maintenance?.staleAfterMs ?? 5 * 60_000;

		workflows.push(
			hatchet.task({
				name: "payload-maintenance",
				on: { cron },
				concurrency: {
					expression: "'maintenance'",
					maxRuns: 1,
					limitStrategy: ConcurrencyLimitStrategy.CANCEL_NEWEST,
				},
				fn: async () => {
					// Queues through the plugin's wrapper, which dispatches the new jobs.
					await payload.jobs.handleSchedules({ allQueues: true });

					const now = new Date().toISOString();
					const staleAt = new Date(Date.now() - staleAfterMs).toISOString();
					const open = [
						{ completedAt: { exists: false } },
						{ hasError: { not_equals: true } },
					];

					// Jobs whose run stopped heartbeating, e.g. after a worker crash.
					await payload.db.updateJobs({
						where: {
							and: [
								...open,
								{ processing: { equals: true } },
								{ hatchetHeartbeatAt: { less_than: staleAt } },
							],
						},
						data: { processing: false },
						returning: false,
					});

					// Covers every queue: dispatch routes each job by its own queue.
					const { docs } = await payload.find({
						collection: "payload-jobs",
						depth: 0,
						limit: STALE_LIMIT,
						overrideAccess: true,
						sort: "hatchetDispatchedAt",
						where: {
							and: [
								...open,
								{ processing: { not_equals: true } },
								{
									or: [
										{ waitUntil: { exists: false } },
										{ waitUntil: { less_than_equal: now } },
									],
								},
								{
									or: [
										{ hatchetDispatchedAt: { less_than: staleAt } },
										{
											and: [
												{ hatchetDispatchedAt: { exists: false } },
												{ createdAt: { less_than: staleAt } },
											],
										},
									],
								},
							],
						},
					});

					/*
					 * A run still queued in Hatchet, e.g. behind its concurrency key, is
					 * not lost. Its job is checked again after another staleAfterMs.
					 */
					const isActive = async (runId: string) => {
						const status = await hatchet.runs
							.get_status(runId)
							.catch(() => undefined);

						return status === QUEUED || status === RUNNING;
					};

					const dispatched = await Promise.all(
						(docs as HatchetJob[]).map(async (job) => {
							if (job.hatchetRunId && (await isActive(job.hatchetRunId))) {
								await payload.db.updateJobs({
									id: job.id,
									data: { hatchetDispatchedAt: new Date().toISOString() },
									returning: false,
								});

								return false;
							}

							await dispatch(job);

							return true;
						}),
					);

					return { dispatched: dispatched.filter(Boolean).length };
				},
			}),
		);
	}

	return await hatchet.worker(options.name ?? "payload", {
		workflows,
		...(options.slots === undefined ? {} : { slots: options.slots }),
		...(options.handleKill === undefined
			? {}
			: { handleKill: options.handleKill }),
	});
};

type PayloadConfig = InitOptions["config"];

export interface RunHatchetWorkerOptions extends Omit<
	HatchetWorkerOptions,
	"payload" | "handleKill"
> {
	/**
	 * The Payload config, e.g. `import config from "@payload-config"`, or a
	 * function loading it, e.g. `() => import("@payload-config")`.
	 */
	config:
		PayloadConfig | (() => Promise<PayloadConfig | { default: PayloadConfig }>);

	/**
	 * Longest wait for running jobs after SIGTERM or SIGINT. Defaults to 30
	 * seconds.
	 */
	shutdownTimeoutMs?: number | undefined;
}

/**
 * Boots Payload and runs the worker until SIGTERM or SIGINT. Resolves once
 * the running jobs finished or `shutdownTimeoutMs` passed. Never exits the
 * process, which stays with the host, e.g. `payload run`.
 */
export const runHatchetWorker = async (
	options: RunHatchetWorkerOptions,
): Promise<void> => {
	const { config, shutdownTimeoutMs = 30_000, ...workerOptions } = options;
	const loaded = typeof config === "function" ? await config() : config;
	const payload = await getPayload({
		config: "default" in loaded ? loaded.default : loaded,
	});
	const worker = await createHatchetWorker({
		...workerOptions,
		payload,
		handleKill: false,
	});

	const stopped = new Promise((resolve) => {
		process.once("SIGTERM", resolve);
		process.once("SIGINT", resolve);
	}).then(() =>
		Promise.race([
			worker.stop(),
			setTimeout(shutdownTimeoutMs, undefined, { ref: false }),
		]),
	);

	// `start()` resolves once a stop drained the running jobs.
	await Promise.race([worker.start().then(() => stopped), stopped]);
};
