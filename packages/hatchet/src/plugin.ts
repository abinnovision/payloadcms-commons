import { HatchetClient } from "@hatchet-dev/typescript-sdk";

import {
	createDispatch,
	defaultDispatchTimeoutMs,
	defaultTaskName,
} from "./dispatch.js";

import type { Dispatcher, HatchetJob } from "./dispatch.js";
import type {
	Collection,
	Field,
	Job,
	Payload,
	PayloadRequest,
	Plugin,
} from "payload";

export interface HatchetPluginOptions {
	/**
	 * Defaults to `true`. When `false`, only the fields are added, so the schema
	 * stays the same, and Payload keeps running its jobs itself.
	 */
	enabled?: boolean | undefined;

	/**
	 * Creates the Hatchet client on the first dispatch. Defaults to
	 * `HatchetClient.init()`, which reads `HATCHET_CLIENT_*` from the environment.
	 */
	client?: (() => HatchetClient) | undefined;

	/**
	 * Maps a Payload queue to the Hatchet task name. Defaults to
	 * `payload-${queue}`. Must match the worker's `taskName`.
	 */
	taskName?: ((queue: string) => string) | undefined;

	/**
	 * Longest wait for each Hatchet call during dispatch, in milliseconds.
	 * Defaults to 2000. A job whose dispatch timed out is recovered by
	 * maintenance.
	 */
	dispatchTimeoutMs?: number | undefined;
}

const admin = { position: "sidebar", readOnly: true } as const;

// Top-level rather than a group, so partial updates never replace sibling values.
const hatchetFields: Field[] = [
	{ name: "hatchetRunId", type: "text", admin },
	{ name: "hatchetScheduledId", type: "text", admin },
	{ name: "hatchetDispatchedAt", type: "date", admin },
	{ name: "hatchetHeartbeatAt", type: "date", admin },
];

/**
 * Dispatches every queued job to Hatchet. Jobs dispatched inside a transaction
 * are held until it commits and dropped when it rolls back, so Hatchet never
 * runs a job that is not visible yet or never existed. Deleting or cancelling
 * a job also deletes its booked run.
 */
export const installDispatch = (
	payload: Payload,
	{ dispatch, unschedule }: Dispatcher,
): void => {
	const pending = new Map<number | string, Job[]>();
	const { cancel, cancelByID, queue } = payload.jobs;

	const dispatchWithReq = async (
		job: HatchetJob,
		req: Partial<PayloadRequest> | undefined,
	): Promise<void> => {
		const txID = await req?.transactionID;

		if (txID) {
			pending.set(txID, [...(pending.get(txID) ?? []), job]);
		} else {
			await dispatch(job);
		}
	};

	payload.jobs.queue = (async (args: Parameters<typeof queue>[0]) => {
		const job = await queue(args);
		await dispatchWithReq(job, args.req);

		return job;
	}) as typeof queue;

	/*
	 * Added after sanitization: Payload warns about hooks returned by
	 * jobsCollectionOverrides, although Local API operations run them.
	 */
	const { hooks } = (payload.collections["payload-jobs"] as Collection).config;

	/*
	 * A runnable job whose waitUntil moved earlier is dispatched again; one moved
	 * later is rescheduled by its early run. The runner only moves waitUntil
	 * later, so `jobs.runHooks` does not dispatch twice.
	 */
	hooks.afterChange.push(async ({ doc, previousDoc, req }) => {
		const job = doc as HatchetJob;
		const next = job.waitUntil ? Date.parse(job.waitUntil) : 0;
		// NaN when unset, which fails the check below.
		const previous = Date.parse(
			(previousDoc as HatchetJob | undefined)?.waitUntil ?? "",
		);

		if (
			!job.completedAt &&
			!job.hasError &&
			!job.processing &&
			previous > Date.now() &&
			next < previous
		) {
			await dispatchWithReq(job, req);
		}
	});

	hooks.afterDelete.push(async ({ doc }) => {
		const scheduledId = (doc as HatchetJob).hatchetScheduledId;

		if (scheduledId) {
			await unschedule(scheduledId);
		}
	});

	// Payload cancels without collection hooks, so the booked runs go here.
	payload.jobs.cancelByID = async (args) => {
		await cancelByID(args);

		const job = (await payload.findByID({
			collection: "payload-jobs",
			id: args.id,
			depth: 0,
			disableErrors: true,
			overrideAccess: true,
			...(args.req ? { req: args.req } : {}),
		})) as HatchetJob | null;

		if (job?.hatchetScheduledId) {
			await unschedule(job.hatchetScheduledId);
		}
	};

	payload.jobs.cancel = async (args) => {
		const { docs } = await payload.find({
			collection: "payload-jobs",
			depth: 0,
			limit: 1000,
			overrideAccess: true,
			...(args.req ? { req: args.req } : {}),
			where: {
				and: [
					args.where,
					{ hatchetScheduledId: { exists: true } },
					...(args.queue ? [{ queue: { equals: args.queue } }] : []),
				],
			},
		});

		await cancel(args);
		await Promise.all(
			(docs as HatchetJob[]).map((job) =>
				unschedule(job.hatchetScheduledId as string),
			),
		);
	};

	const { db } = payload;
	const commit = db.commitTransaction.bind(db);
	const rollback = db.rollbackTransaction.bind(db);

	db.commitTransaction = async (id) => {
		const txID = await id;
		const jobs = pending.get(txID) ?? [];

		try {
			await commit(txID);
		} finally {
			pending.delete(txID);
		}

		await Promise.all(jobs.map(dispatch));
	};

	db.rollbackTransaction = async (id) => {
		pending.delete(await id);
		await rollback(id);
	};
};

/**
 * Makes Hatchet the only trigger of Payload jobs. Payload keeps the jobs
 * collection as the system of record and executes the jobs; Hatchet decides
 * when and where. Pair with `createHatchetWorker` from `./worker`.
 */
export const hatchetPlugin = (options: HatchetPluginOptions = {}): Plugin => {
	const enabled = options.enabled ?? true;

	const plugin: Plugin = (config) => {
		const jobs = { ...config.jobs };
		const overrides = jobs.jobsCollectionOverrides;

		if (enabled) {
			// Hatchet is the only trigger, so Payload's cron runner and run endpoint stay off.
			delete jobs.autoRun;
			jobs.access = { ...jobs.access, run: jobs.access?.run ?? (() => false) };
		}

		return {
			...config,
			jobs: {
				...jobs,
				jobsCollectionOverrides: ({ defaultJobsCollection }) => {
					const collection = overrides
						? overrides({ defaultJobsCollection })
						: defaultJobsCollection;

					return {
						...collection,
						fields: [...collection.fields, ...hatchetFields],
					};
				},
			},
			onInit: async (payload) => {
				if (enabled && !payload.collections["payload-jobs"]) {
					payload.logger.debug(
						"Skipped installing the hatchet plugin: no jobs are configured.",
					);
				} else if (enabled) {
					installDispatch(
						payload,
						createDispatch({
							payload,
							client: options.client ?? (() => HatchetClient.init()),
							taskName: options.taskName ?? defaultTaskName,
							timeoutMs: options.dispatchTimeoutMs ?? defaultDispatchTimeoutMs,
						}),
					);
				}

				await config.onInit?.(payload);
			},
		};
	};

	plugin.slug = "hatchet";

	return plugin;
};
