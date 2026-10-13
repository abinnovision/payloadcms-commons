import { NonRetryableError } from "@hatchet-dev/typescript-sdk";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

import { runJob } from "./run-job.js";
import { bootPayload, createFakeHatchet } from "../../test/payload.js";

import type { HatchetJob } from "../dispatch.js";
import type { HatchetClient } from "@hatchet-dev/typescript-sdk";
import type { Job, Payload } from "payload";

describe("runJob", () => {
	const dispatch = vi.fn(() => Promise.resolve());
	const getStatus = vi.fn(() => Promise.resolve("CANCELLED"));
	let payload: Payload;

	beforeAll(async () => {
		payload = await bootPayload({
			key: "hatchet-run-job",
			hatchet: createFakeHatchet().client,
		});
	});

	beforeEach(() => {
		dispatch.mockClear();
	});

	afterAll(async () => {
		await payload.destroy();
	});

	const queue = async (
		task: string,
		waitUntil?: Date,
		input: object = {},
	): Promise<string> => {
		const job = (await payload.jobs.queue({
			task: task as never,
			input,
			...(waitUntil ? { waitUntil } : {}),
		})) as Job;

		return String(job.id);
	};

	const findJob = async (jobId: string) =>
		(await payload.findByID({
			collection: "payload-jobs",
			id: jobId,
			disableErrors: true,
		})) as HatchetJob | null;

	const run = (
		jobId: string,
		ctx: {
			slug?: string;
			runId?: string;
			retryCount?: number;
			queue?: string;
			abortController?: AbortController;
			maxDurationMs?: number;
		} = {},
	) =>
		runJob({
			payload,
			hatchet: {
				runs: { get_status: getStatus },
			} as unknown as HatchetClient,
			dispatch,
			input: {
				jobId,
				queue: ctx.queue ?? "default",
				slug: ctx.slug ?? "ok",
				concurrencyKey: jobId,
			},
			ctx: {
				abortController: ctx.abortController ?? new AbortController(),
				workflowRunId: () => ctx.runId ?? "run-1",
				retryCount: () => ctx.retryCount ?? 0,
				refreshTimeout: () => Promise.resolve(),
			},
			heartbeatMs: 1_000,
			maxDurationMs: ctx.maxDurationMs,
		});

	const hold = async (
		jobId: string,
		runId: string,
		heartbeatAt?: Date,
	): Promise<void> => {
		await payload.db.updateJobs({
			id: jobId,
			data: {
				processing: true,
				hatchetRunId: runId,
				hatchetHeartbeatAt: heartbeatAt?.toISOString() ?? null,
			},
			returning: false,
		});
	};

	const expectRetryable = async (promise: Promise<unknown>): Promise<void> => {
		const error = await promise.catch((err: unknown) => err);

		expect(error).toBeInstanceOf(Error);
		expect(error).not.toBeInstanceOf(NonRetryableError);
	};

	it("runs a job to success", async () => {
		const jobId = await queue("ok");

		await expect(run(jobId)).resolves.toEqual({ status: "success" });
		expect(await findJob(jobId)).toBeNull();
	});

	it("dispatches the next attempt when Payload will retry", async () => {
		const jobId = await queue("fail");

		await expect(run(jobId, { slug: "fail" })).resolves.toEqual({
			status: "retry-dispatched",
		});
		expect(dispatch).toHaveBeenCalledWith(
			expect.objectContaining({ id: Number(jobId), totalTried: 1 }),
		);
	});

	it("fails without Hatchet retries once Payload gives up", async () => {
		const jobId = await queue("failFinal");

		await expect(run(jobId, { slug: "failFinal" })).rejects.toBeInstanceOf(
			NonRetryableError,
		);
	});

	it("skips a cancelled job", async () => {
		const jobId = await queue("cancel");

		await expect(run(jobId, { slug: "cancel" })).resolves.toEqual({
			status: "skipped",
		});
	});

	it("skips a job that no longer exists", async () => {
		await expect(run("999999")).resolves.toEqual({ status: "skipped" });
	});

	it("re-schedules a job that is not due yet and stamps the run id", async () => {
		const jobId = await queue("ok", new Date(Date.now() + 60_000));

		await expect(run(jobId)).resolves.toEqual({ status: "scheduled" });
		expect(dispatch).toHaveBeenCalledOnce();
		expect((await findJob(jobId))?.hatchetRunId).toBe("run-1");
	});

	it("skips a job held by another runner", async () => {
		const jobId = await queue("ok");
		await hold(jobId, "run-other", new Date());

		await expect(run(jobId, { retryCount: 1 })).resolves.toEqual({
			status: "skipped",
		});
		expect((await findJob(jobId))?.processing).toBe(true);
	});

	it.each([
		["slug", { slug: "fail" }],
		["queue", { queue: "other" }],
	])("skips a run whose %s does not match the job", async (_field, ctx) => {
		const jobId = await queue("ok");
		const warn = vi.spyOn(payload.logger, "warn");

		await expect(run(jobId, ctx)).resolves.toEqual({ status: "skipped" });
		expect(warn).toHaveBeenCalledOnce();
		expect(await findJob(jobId)).toMatchObject({
			processing: false,
			totalTried: 0,
		});
		warn.mockRestore();
	});

	it("leaves a job with a slug unknown to this worker pending", async () => {
		const jobId = await queue("ok");
		await payload.db.updateJobs({
			id: jobId,
			data: { taskSlug: "unknown" },
			returning: false,
		});

		await expect(run(jobId, { slug: "unknown" })).resolves.toEqual({
			status: "skipped",
		});
		expect(await findJob(jobId)).toMatchObject({
			processing: false,
			hasError: false,
		});
	});

	it("cancels a job that exceeds maxDurationMs", async () => {
		const jobId = await queue("wait", undefined, { ms: 60_000 });

		await expect(
			run(jobId, { slug: "wait", maxDurationMs: 50 }),
		).rejects.toBeInstanceOf(NonRetryableError);
		expect((await findJob(jobId))?.error).toEqual({ cancelled: true });
	});

	it("does not cancel a job that completed meanwhile", async () => {
		const jobId = await queue("wait", undefined, { ms: 60_000 });
		const result = run(jobId, { slug: "wait", maxDurationMs: 500 });
		await vi.waitFor(async () => {
			expect((await findJob(jobId))?.processing).toBe(true);
		});
		await payload.db.updateJobs({
			id: jobId,
			data: { completedAt: new Date().toISOString() },
			returning: false,
		});

		await expect(result).rejects.toBeInstanceOf(NonRetryableError);
		expect(await findJob(jobId)).toMatchObject({
			hasError: false,
			completedAt: expect.any(String),
		});
	});

	it("releases the job and retries when Payload's runner throws", async () => {
		const jobId = await queue("crash");

		await expectRetryable(run(jobId, { slug: "crash" }));
		expect((await findJob(jobId))?.processing).toBe(false);
	});

	// Aborts mid-task: SQLite cannot take the cancel's write while the claim writes.
	const abortWhileRunning = async (jobId: string) => {
		const abortController = new AbortController();
		const result = run(jobId, { slug: "wait", abortController });
		await vi.waitFor(async () => {
			expect((await findJob(jobId))?.processing).toBe(true);
		});
		abortController.abort();

		return await result;
	};

	it("cancels the job when its Hatchet run is cancelled", async () => {
		const jobId = await queue("wait", undefined, { ms: 300 });

		await expect(abortWhileRunning(jobId)).resolves.toEqual({
			status: "skipped",
		});
		expect((await findJob(jobId))?.error).toEqual({ cancelled: true });
	});

	it("does not cancel a job another run took over", async () => {
		const jobId = await queue("wait", undefined, { ms: 300 });
		const abortController = new AbortController();
		const result = run(jobId, { slug: "wait", abortController });
		await vi.waitFor(async () => {
			expect((await findJob(jobId))?.processing).toBe(true);
		});
		await payload.db.updateJobs({
			id: jobId,
			data: { hatchetRunId: "run-other" },
			returning: false,
		});
		abortController.abort();

		await expect(result).resolves.toEqual({ status: "success" });
	});

	it("keeps running the job when its Hatchet run timed out", async () => {
		getStatus.mockResolvedValueOnce("FAILED");
		const jobId = await queue("wait", undefined, { ms: 300 });

		await expect(abortWhileRunning(jobId)).resolves.toEqual({
			status: "success",
		});
	});

	it("leaves a job whose earlier attempt still heartbeats", async () => {
		const jobId = await queue("ok");
		await hold(jobId, "run-1", new Date());

		await expectRetryable(run(jobId, { retryCount: 1 }));
		expect((await findJob(jobId))?.processing).toBe(true);
	});

	it("releases a job its own crashed attempt left processing", async () => {
		const jobId = await queue("ok");
		await hold(jobId, "run-1");

		await expect(run(jobId, { retryCount: 1 })).resolves.toEqual({
			status: "success",
		});
	});
});
