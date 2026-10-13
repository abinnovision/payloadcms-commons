import { APIContracts, NonRetryableError } from "@hatchet-dev/typescript-sdk";

import type { Dispatch, HatchetJob, JobRunInput } from "../dispatch.js";
import type {
	Context,
	HatchetClient,
	JsonObject,
} from "@hatchet-dev/typescript-sdk";
import type { Payload } from "payload";

export interface RunJobOutput extends JsonObject {
	status: "retry-dispatched" | "scheduled" | "skipped" | "success";
}

/**
 * Returns the slug of the job a run is for. The run input is not trusted, so a
 * job that is missing or whose queue or slug differs yields `null`.
 */
const verifySlug = async (
	payload: Payload,
	input: JobRunInput,
): Promise<null | string> => {
	const job = (await payload.findByID({
		collection: "payload-jobs",
		id: input.jobId,
		depth: 0,
		disableErrors: true,
		overrideAccess: true,
	})) as HatchetJob | null;

	if (!job) {
		return null;
	}

	const slug = job.taskSlug ?? job.workflowSlug ?? "";

	if ((job.queue ?? "default") !== input.queue || slug !== input.slug) {
		payload.logger.warn(
			`Skipped Payload job ${input.jobId}: its queue or slug does not match the Hatchet run input.`,
		);

		return null;
	}

	return slug;
};

/**
 * Executes one Payload job inside a Hatchet run. Payload claims and runs the
 * job and owns its retries; the outcome decides whether Hatchet schedules a
 * follow-up run, retries this one, or stops.
 */
export const runJob = async (args: {
	payload: Payload;
	hatchet: Pick<HatchetClient, "runs">;
	dispatch: Dispatch;
	input: JobRunInput;
	ctx: Pick<
		Context<JobRunInput>,
		"abortController" | "refreshTimeout" | "retryCount" | "workflowRunId"
	>;
	heartbeatMs: number;
	maxDurationMs?: number | undefined;
}): Promise<RunJobOutput> => {
	const { payload, hatchet, dispatch, ctx, heartbeatMs, maxDurationMs } = args;
	const { jobId } = args.input;
	const { signal } = ctx.abortController;
	const runId = ctx.workflowRunId();
	const ownRun = [
		{ id: { equals: jobId } },
		{ hatchetRunId: { equals: runId } },
	];
	// Payload's cancel leaves completed and failed jobs alone.
	const cancel = () =>
		payload.jobs.cancel({ where: { and: ownRun }, overrideAccess: true });
	let heartbeat: NodeJS.Timeout | undefined;
	let timeout: NodeJS.Timeout | undefined;

	/*
	 * Hatchet aborts both on cancellation and on its own timeout. Only a
	 * cancellation cancels the job, at Payload's next task boundary.
	 */
	const onAbort = () => {
		hatchet.runs
			.get_status(runId)
			.then((status) =>
				status === APIContracts.V1TaskStatus.CANCELLED ? cancel() : undefined,
			)
			.catch((err: unknown) => {
				payload.logger.error({
					err,
					msg: `Failed to cancel Payload job ${jobId} after its Hatchet run was cancelled.`,
				});
			});
	};

	const slug = await verifySlug(payload, args.input);

	if (slug === null) {
		return { status: "skipped" };
	}

	// Payload would fail a job with an unknown slug for good, so it waits for a worker that knows it.
	const { tasks = [], workflows = [] } = payload.config.jobs;

	if (![...tasks, ...workflows].some((config) => config.slug === slug)) {
		payload.logger.warn(
			`Skipped Payload job ${jobId}: '${slug}' is not registered on this worker.`,
		);

		return { status: "skipped" };
	}

	try {
		signal.addEventListener("abort", onAbort, { once: true });

		/*
		 * A retry of this run means an earlier attempt died while holding the
		 * job. It is released only once that attempt stopped heartbeating.
		 */
		if (ctx.retryCount() > 0) {
			const staleAt = new Date(Date.now() - 3 * heartbeatMs).toISOString();

			await payload.db.updateJobs({
				where: {
					and: [
						...ownRun,
						{
							or: [
								{ hatchetHeartbeatAt: { exists: false } },
								{ hatchetHeartbeatAt: { less_than: staleAt } },
							],
						},
					],
				},
				data: { processing: false },
				returning: false,
			});
		}

		await payload.db.updateJobs({
			where: {
				and: [
					{ id: { equals: jobId } },
					{ processing: { not_equals: true } },
					{ completedAt: { exists: false } },
				],
			},
			data: {
				hatchetRunId: runId,
				hatchetHeartbeatAt: new Date().toISOString(),
			},
			returning: false,
		});

		// refreshTimeout extends the timeout by the given amount, so it matches the interval.
		heartbeat = setInterval(() => {
			Promise.all([
				ctx.refreshTimeout(heartbeatMs),
				payload.db.updateJobs({
					where: { and: ownRun },
					data: { hatchetHeartbeatAt: new Date().toISOString() },
					returning: false,
				}),
			]).catch((err: unknown) => {
				payload.logger.warn({
					err,
					msg: `Failed to heartbeat Payload job ${jobId}.`,
				});
			});
		}, heartbeatMs);

		const running = payload.jobs
			.run({ allQueues: true, limit: 1, where: { id: { equals: jobId } } })
			.catch(async (err: unknown) => {
				// Released at once, so the Hatchet retry need not wait for the heartbeat to go stale.
				await payload.db
					.updateJobs({
						where: { and: ownRun },
						data: { processing: false },
						returning: false,
					})
					.catch(() => undefined);

				throw err;
			});
		// A job cut off by maxDurationMs keeps running, so it must not reject unhandled.
		running.catch(() => undefined);

		const result = await Promise.race([
			running,
			new Promise<never>((_resolve, reject) => {
				if (maxDurationMs === undefined) {
					return;
				}

				timeout = setTimeout(() => {
					clearInterval(heartbeat);
					void cancel()
						.catch((err: unknown) => {
							payload.logger.error({
								err,
								msg: `Failed to cancel Payload job ${jobId} after maxDurationMs.`,
							});
						})
						.then(() => {
							reject(
								new NonRetryableError(
									`Payload job ${jobId} exceeded maxDurationMs and was cancelled.`,
								),
							);
						});
				}, maxDurationMs);
			}),
		]);
		const status = result.jobStatus?.[jobId]?.status;

		if (status === "success") {
			// The booked run that led here has fired; drop the pointer to it.
			await payload.db.updateJobs({
				where: { id: { equals: jobId } },
				data: { hatchetScheduledId: null },
				returning: false,
			});

			return { status };
		}

		// Payload deletes completed jobs by default, so a missing job is normal.
		const job = (await payload.findByID({
			collection: "payload-jobs",
			id: jobId,
			depth: 0,
			disableErrors: true,
			overrideAccess: true,
		})) as HatchetJob | null;

		if (status === "error-reached-max-retries") {
			if ((job?.error as { cancelled?: boolean } | undefined)?.cancelled) {
				return { status: "skipped" };
			}

			throw new NonRetryableError(
				`Payload job ${jobId} failed and reached its max retries.`,
			);
		}

		if (status === "error") {
			if (!job) {
				return { status: "skipped" };
			}

			// Payload set the backoff as `waitUntil`; the next run starts there.
			await dispatch(job);

			return { status: "retry-dispatched" };
		}

		if (!job || job.completedAt || job.hasError) {
			return { status: "skipped" };
		}

		if (job.waitUntil && new Date(job.waitUntil).getTime() > Date.now()) {
			await dispatch(job);

			return { status: "scheduled" };
		}

		/*
		 * Another runner holds the job, e.g. Payload's own. Only an earlier attempt
		 * of this run is waited for; maintenance re-dispatches a job left pending.
		 */
		if (
			job.processing &&
			(job.hatchetRunId !== runId || ctx.retryCount() === 0)
		) {
			return { status: "skipped" };
		}

		throw new Error(`Payload job ${jobId} could not be claimed yet.`);
	} finally {
		clearInterval(heartbeat);
		clearTimeout(timeout);
		signal.removeEventListener("abort", onAbort);
	}
};
