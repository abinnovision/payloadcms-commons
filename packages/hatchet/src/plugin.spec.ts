import {
	commitTransaction,
	createLocalReq,
	initTransaction,
	killTransaction,
} from "payload";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

import { bootPayload, createFakeHatchet } from "../test/payload.js";

import type { HatchetJob } from "./dispatch.js";
import type { Payload, PayloadRequest } from "payload";

describe("hatchetPlugin", () => {
	const hatchet = createFakeHatchet();
	let dispatchedInAppOnInit = 0;
	let payload: Payload;

	beforeAll(async () => {
		payload = await bootPayload({
			key: "hatchet-plugin",
			hatchet: hatchet.client,
			plugin: { dispatchTimeoutMs: 50 },
			config: {
				onInit: async (instance) => {
					// The wrapper is in place before the app's own onInit runs.
					await instance.jobs.queue({ task: "ok", input: {} });
					dispatchedInAppOnInit = hatchet.runNoWait.mock.calls.length;
				},
				jobs: {
					autoRun: [{ cron: "* * * * *" }],
					jobsCollectionOverrides: ({ defaultJobsCollection }) => ({
						...defaultJobsCollection,
						fields: [
							...defaultJobsCollection.fields,
							{ name: "note", type: "text" },
						],
					}),
				},
			},
		});
	});

	beforeEach(() => {
		hatchet.runNoWait.mockClear();
		hatchet.create.mockClear();
		hatchet.deleteSchedule.mockClear();
	});

	afterAll(async () => {
		await payload.destroy();
	});

	it("runs its onInit before the app's", () => {
		expect(dispatchedInAppOnInit).toBe(1);
	});

	it("disables autoRun and adds the hatchet fields after other overrides", () => {
		const names = payload.collections["payload-jobs"]?.config.fields.map(
			(field) => ("name" in field ? field.name : undefined),
		);

		expect(payload.config.jobs.autoRun).toBeUndefined();
		expect(names).toEqual(
			expect.arrayContaining([
				"note",
				"hatchetRunId",
				"hatchetScheduledId",
				"hatchetDispatchedAt",
				"hatchetHeartbeatAt",
			]),
		);
	});

	it("denies Payload's run endpoint even to signed-in users", async () => {
		const req = { user: {} } as unknown as PayloadRequest;

		expect(await payload.config.jobs.access?.run?.({ req })).toBe(false);
	});

	it("dispatches a job queued outside a transaction immediately", async () => {
		const job = await payload.jobs.queue({ task: "ok", input: {} });
		const jobId = String(job.id);

		expect(hatchet.runNoWait).toHaveBeenCalledWith(
			"payload-default",
			{ jobId, queue: "default", slug: "ok", concurrencyKey: `job:${jobId}` },
			{ additionalMetadata: { payloadJobId: jobId, slug: "ok" } },
		);
		expect(
			await payload.findByID({ collection: "payload-jobs", id: job.id }),
		).toMatchObject({
			hatchetDispatchedAt: expect.any(String),
			hatchetRunId: expect.stringMatching(/^run-/),
		});
	});

	it("schedules a job that waits until a future date", async () => {
		const waitUntil = new Date(Date.now() + 60_000);
		await payload.jobs.queue({
			task: "ok",
			input: {},
			queue: "mail",
			waitUntil,
		});

		expect(hatchet.runNoWait).not.toHaveBeenCalled();
		expect(hatchet.create).toHaveBeenCalledWith(
			"payload-mail",
			expect.objectContaining({ triggerAt: waitUntil }),
		);
	});

	it("holds a job queued in a transaction until it commits", async () => {
		const req = await createLocalReq({}, payload);
		await initTransaction(req);
		await payload.jobs.queue({ task: "ok", input: {}, req });

		expect(hatchet.runNoWait).not.toHaveBeenCalled();

		await commitTransaction(req);

		expect(hatchet.runNoWait).toHaveBeenCalledOnce();
	});

	it("dispatches every job of a committed transaction", async () => {
		const req = await createLocalReq({}, payload);
		await initTransaction(req);
		await payload.jobs.queue({ task: "ok", input: {}, req });
		await payload.jobs.queue({ task: "ok", input: {}, req });
		await commitTransaction(req);

		expect(hatchet.runNoWait).toHaveBeenCalledTimes(2);
	});

	it("drops a job queued in a transaction that rolls back", async () => {
		const req = await createLocalReq({}, payload);
		await initTransaction(req);
		await payload.jobs.queue({ task: "ok", input: {}, req });
		await killTransaction(req);
		await commitTransaction(await createLocalReq({}, payload));

		expect(hatchet.runNoWait).not.toHaveBeenCalled();
	});

	it("logs and records the attempt when Hatchet is unreachable", async () => {
		hatchet.runNoWait.mockRejectedValueOnce(new Error("unreachable"));
		const error = vi.spyOn(payload.logger, "error");

		const job = await payload.jobs.queue({ task: "ok", input: {} });

		expect(error).toHaveBeenCalledOnce();
		expect(
			await payload.findByID({ collection: "payload-jobs", id: job.id }),
		).toMatchObject({ hatchetDispatchedAt: expect.any(String) });
	});

	it("gives up on a Hatchet call after dispatchTimeoutMs", async () => {
		hatchet.runNoWait.mockReturnValueOnce(
			new Promise(() => {
				// Never settles.
			}),
		);
		const warn = vi.spyOn(payload.logger, "warn");

		const job = await payload.jobs.queue({ task: "ok", input: {} });

		expect(warn).toHaveBeenCalledOnce();
		expect(
			await payload.findByID({ collection: "payload-jobs", id: job.id }),
		).toMatchObject({ hatchetDispatchedAt: expect.any(String) });
	});

	const queueScheduled = async (): Promise<HatchetJob> => {
		const job = await payload.jobs.queue({
			task: "ok",
			input: {},
			waitUntil: new Date(Date.now() + 60_000),
		});
		hatchet.create.mockClear();

		return (await payload.findByID({
			collection: "payload-jobs",
			id: job.id,
		})) as HatchetJob;
	};

	const moveWaitUntil = (job: HatchetJob, ms: number, req?: PayloadRequest) =>
		payload.update({
			collection: "payload-jobs",
			id: job.id,
			data: { waitUntil: new Date(Date.now() + ms).toISOString() },
			...(req ? { req } : {}),
		});

	it("stores the scheduled run id on the job", async () => {
		const job = await queueScheduled();

		expect(job.hatchetScheduledId).toMatch(/^scheduled-/);
	});

	it("re-dispatches a job whose waitUntil moved earlier", async () => {
		const job = await queueScheduled();
		await moveWaitUntil(job, 10_000);

		expect(hatchet.deleteSchedule).toHaveBeenCalledWith(job.hatchetScheduledId);
		expect(hatchet.create).toHaveBeenCalledOnce();
	});

	it("leaves a job whose waitUntil moved later", async () => {
		const job = await queueScheduled();
		await moveWaitUntil(job, 120_000);

		expect(hatchet.create).not.toHaveBeenCalled();
		expect(hatchet.deleteSchedule).not.toHaveBeenCalled();
	});

	it("re-dispatches a moved job once its transaction commits", async () => {
		const job = await queueScheduled();
		const req = await createLocalReq({}, payload);
		await initTransaction(req);
		await moveWaitUntil(job, 10_000, req);

		expect(hatchet.create).not.toHaveBeenCalled();

		await commitTransaction(req);

		expect(hatchet.create).toHaveBeenCalledOnce();
	});

	it("deletes the scheduled run of a deleted job", async () => {
		const job = await queueScheduled();
		await payload.delete({ collection: "payload-jobs", id: job.id });

		expect(hatchet.deleteSchedule).toHaveBeenCalledWith(job.hatchetScheduledId);
	});

	it("deletes the scheduled run of a cancelled job", async () => {
		const job = await queueScheduled();
		await payload.jobs.cancelByID({ id: job.id });

		expect(hatchet.deleteSchedule).toHaveBeenCalledWith(job.hatchetScheduledId);
	});

	it("deletes the scheduled runs of jobs cancelled by a query", async () => {
		const job = await queueScheduled();
		await payload.jobs.cancel({ where: { id: { equals: job.id } } });

		expect(hatchet.deleteSchedule).toHaveBeenCalledExactlyOnceWith(
			job.hatchetScheduledId,
		);
	});
});

describe("hatchetPlugin without jobs", () => {
	it("boots without installing anything and keeps a custom run access", async () => {
		const hatchet = createFakeHatchet();
		const run = () => true;
		const payload = await bootPayload({
			key: "hatchet-plugin-no-jobs",
			hatchet: hatchet.client,
			config: { jobs: { tasks: [], access: { run } } },
		});

		expect(payload.collections["payload-jobs"]).toBeUndefined();
		expect(payload.config.jobs.access?.run).toBe(run);

		await payload.destroy();
	});
});

describe("hatchetPlugin disabled", () => {
	const hatchet = createFakeHatchet();
	let payload: Payload;

	beforeAll(async () => {
		payload = await bootPayload({
			key: "hatchet-plugin-disabled",
			hatchet: hatchet.client,
			plugin: { enabled: false },
			config: { jobs: { autoRun: [{ cron: "* * * * *" }] } },
		});
	});

	afterAll(async () => {
		await payload.destroy();
	});

	it("adds the fields but leaves Payload's runner in charge", async () => {
		const names = payload.collections["payload-jobs"]?.config.fields.map(
			(field) => ("name" in field ? field.name : undefined),
		);

		await payload.jobs.queue({ task: "ok", input: {} });

		expect(names).toContain("hatchetRunId");
		expect(payload.config.jobs.autoRun).toHaveLength(1);
		expect(
			await payload.config.jobs.access?.run?.({
				req: { user: {} } as unknown as PayloadRequest,
			}),
		).toBe(true);
		expect(hatchet.runNoWait).not.toHaveBeenCalled();
	});
});
