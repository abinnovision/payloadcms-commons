import { ConcurrencyLimitStrategy } from "@hatchet-dev/typescript-sdk";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createHatchetWorker } from "./index.js";
import { bootPayload, createFakeHatchet } from "../../test/payload.js";

import type { HatchetJob } from "../dispatch.js";
import type { HatchetClient } from "@hatchet-dev/typescript-sdk";
import type { Payload } from "payload";

interface TaskDefinition {
	name: string;
	on?: { cron: string };
	concurrency?: { limitStrategy: ConcurrencyLimitStrategy }[];
	fn: () => Promise<{ dispatched: number }>;
}

describe("createHatchetWorker", () => {
	const fake = createFakeHatchet();
	const hatchet = {
		runNoWait: fake.runNoWait,
		schedules: { create: fake.create },
		runs: fake.client.runs,
		task: (definition: TaskDefinition) => definition,
		worker: (_name: string, options: { workflows: TaskDefinition[] }) =>
			Promise.resolve(options),
	} as unknown as HatchetClient;
	let payload: Payload;
	let tasks: TaskDefinition[];

	beforeAll(async () => {
		payload = await bootPayload({
			key: "hatchet-worker",
			hatchet: createFakeHatchet().client,
		});
		const worker = (await createHatchetWorker({
			payload,
			hatchet,
			queues: ["default"],
			maintenance: { staleAfterMs: 0 },
		})) as unknown as { workflows: TaskDefinition[] };
		tasks = worker.workflows;
	});

	beforeEach(() => {
		fake.runNoWait.mockClear();
	});

	afterAll(async () => {
		await payload.destroy();
	});

	it("registers a queueing task per queue and the maintenance cron", () => {
		expect(tasks.map((task) => task.name)).toEqual([
			"payload-default",
			"payload-maintenance",
		]);
		expect(tasks[0]?.concurrency?.map((c) => c.limitStrategy)).toEqual([
			ConcurrencyLimitStrategy.GROUP_ROUND_ROBIN,
			ConcurrencyLimitStrategy.GROUP_ROUND_ROBIN,
		]);
		expect(tasks[1]?.on).toEqual({ cron: "*/5 * * * *" });
	});

	it("releases stale jobs and re-dispatches them across all queues", async () => {
		const ids = await Promise.all(
			["default", "other", "stuck"].map(async (queue) =>
				String((await payload.jobs.queue({ task: "ok", input: {}, queue })).id),
			),
		);
		await payload.jobs.queue({
			task: "ok",
			input: {},
			waitUntil: new Date(Date.now() + 60_000),
		});
		await payload.db.updateJobs({
			id: ids[2] as string,
			data: {
				processing: true,
				hatchetHeartbeatAt: "2000-01-01T00:00:00.000Z",
			},
			returning: false,
		});
		await sleep(5);

		await expect(tasks[1]?.fn()).resolves.toEqual({ dispatched: 3 });
		expect(
			fake.runNoWait.mock.calls.map((call) => (call as unknown[])[0]),
		).toEqual(
			expect.arrayContaining([
				"payload-default",
				"payload-other",
				"payload-stuck",
			]),
		);
	});

	it("skips a stale job whose Hatchet run is still queued", async () => {
		const { id } = await payload.jobs.queue({ task: "ok", input: {} });
		await payload.db.updateJobs({
			id,
			data: {
				hatchetRunId: "run-queued",
				hatchetDispatchedAt: "2000-01-01T00:00:00.000Z",
			},
			returning: false,
		});
		fake.getStatus.mockImplementation((runId) =>
			Promise.resolve(runId === "run-queued" ? "QUEUED" : "COMPLETED"),
		);
		await sleep(5);

		await tasks[1]?.fn();
		const job = (await payload.findByID({
			collection: "payload-jobs",
			id,
		})) as HatchetJob;

		expect(fake.getStatus).toHaveBeenCalledWith("run-queued");
		expect(
			fake.runNoWait.mock.calls.map((call) => (call as unknown[])[1]),
		).not.toContainEqual(expect.objectContaining({ jobId: String(id) }));
		expect(job.hatchetDispatchedAt).not.toBe("2000-01-01T00:00:00.000Z");
	});
});
