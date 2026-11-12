import { randomUUID } from "node:crypto";
import { createPayloadRequest } from "payload";
import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";

import {
	API_KEYS_SLUG,
	bootPayload,
	count,
	RECORDED_SUBMISSION,
	seed,
	send,
	shutdown,
	THREADS_SLUG,
} from "./helpers/payload.js";
import { queueFlueRun } from "../../src/index.js";
import { handleHash } from "../../src/threads/handle.js";
import { EDITOR, RESTRICTED, SIDECAR_SECRET } from "../fixtures/config.js";

import type { Booted, Doc, Seeded } from "./helpers/payload.js";
import type {
	FlueAgentConfig,
	FlueRunInput,
	FlueRunOutput,
} from "../../src/index.js";
import type { TaskHandler, WorkflowConfig } from "payload";

const AGENT_EMAIL = "agent@example.com";
const JOBS = "payload-jobs";

const DIGEST: FlueAgentConfig = {
	slug: "digest",
	capabilities: { collections: { pages: { read: true } } },
	ambient: { cron: "* * * * * *", message: "Summarise today's changes." },
};

// Boots the fixture with an agent user, seeds it and the usual users.
const bootWithAgentUser = async (
	cacheKey: string,
	flue: Parameters<typeof bootPayload>[1] = {},
	overrides: Parameters<typeof bootPayload>[2] = {},
): Promise<{ booted: Booted; seeded: Seeded; agentUser: Doc }> => {
	const booted = await bootPayload(
		cacheKey,
		{ agentUser: { email: AGENT_EMAIL }, ...flue },
		overrides,
	);
	const seeded = await seed(booted.payload);
	const agentUser = await booted.payload.create({
		collection: "users",
		data: { email: AGENT_EMAIL, password: "agent-secret" },
		overrideAccess: true,
	});

	return { booted, seeded, agentUser };
};

/** The job fields the dispatch keys its thread on. */
interface JobRef {
	id: number | string;
	createdAt: unknown;
}

// A job for the handler alone, which the runner never stored.
const handlerJob = (id: string): JobRef => ({
	id,
	createdAt: "2026-11-08T12:00:00.000Z",
});

const dispatchKey = (job: JobRef): string =>
	`${String(job.id)}@${String(job.createdAt)}`;

const threadOfJob = async (
	booted: Booted,
	job: JobRef,
): Promise<Doc | undefined> =>
	(
		await booted.payload.find({
			collection: THREADS_SLUG,
			where: { dispatchJob: { equals: dispatchKey(job) } },
			depth: 0,
			overrideAccess: true,
			showHiddenFields: true,
		})
	).docs[0];

const findJob = async (booted: Booted, id: number | string): Promise<Doc> =>
	await booted.payload.findByID({
		collection: JOBS,
		id,
		depth: 0,
		overrideAccess: true,
	});

// Runs the task's handler as the job runner would, for `job`.
const runHandler = async (
	booted: Booted,
	input: FlueRunInput,
	job: JobRef,
): Promise<FlueRunOutput> => {
	const task = booted.payload.config.jobs.tasks?.find(
		(candidate) => candidate.slug === "flue-dispatch",
	);
	const handler = task?.handler as
		TaskHandler<{ input: FlueRunInput; output: FlueRunOutput }> | undefined;

	if (handler === undefined) {
		throw new Error("The flue-dispatch task has no handler.");
	}

	const result = await handler({
		input,
		job,
		req: await createPayloadRequest({ payload: booted.payload }),
	} as unknown as Parameters<typeof handler>[0]);

	return result.output;
};

describe("flue-dispatch", () => {
	let booted: Booted;
	let seeded: Seeded;
	let agentUser: Doc;

	const posts = (from = 0) =>
		booted.sidecar.requests
			.slice(from)
			.filter((request) => request.method === "POST");

	beforeAll(async () => {
		({ booted, seeded, agentUser } = await bootWithAgentUser("flue-dispatch", {
			agents: [EDITOR, RESTRICTED, DIGEST],
		}));
	});

	beforeEach(() => {
		booted.sidecar.reset();
	});

	afterAll(async () => {
		await shutdown(booted);
	});

	it("queues and runs a reactive run as the agent user on behalf of the triggering user", async () => {
		const page = await booted.payload.create({
			collection: "pages",
			data: { title: "Published" },
			overrideAccess: true,
		});
		const job = await queueFlueRun(booted.payload, {
			agent: "editor",
			message: "Review the published page.",
			onBehalfOf: seeded.first.id,
			context: { collection: "pages", id: String(page.id) },
		});

		const { jobStatus } = await booted.payload.jobs.run({
			queue: "flue",
			overrideAccess: true,
		});

		const thread = await threadOfJob(booted, job);
		const [posted] = posts().filter((request) =>
			request.path.endsWith(`/${String(thread?.["conversationId"])}`),
		);
		const keys = await booted.payload.count({
			collection: API_KEYS_SLUG,
			where: {
				user: { equals: agentUser.id },
				managedBy: { equals: "flue:editor" },
			},
			overrideAccess: true,
		});

		expect(jobStatus?.[String(job.id)]).toEqual({ status: "success" });
		expect(thread).toMatchObject({
			kind: "reactive",
			agent: "editor",
			createdBy: { relationTo: "users", value: agentUser.id },
			onBehalfOf: seeded.first.id,
			context: { collection: "pages", docId: String(page.id) },
			status: "running",
		});
		expect(keys.totalDocs).toBe(1);
		expect(JSON.parse(posted?.body ?? "{}")).toMatchObject({
			kind: "signal",
			body: "Review the published page.",
			attributes: {
				turn: "user",
				kind: "reactive",
				onBehalfOf: String(seeded.first.id),
				collection: "pages",
				id: String(page.id),
			},
		});
	});

	it("creates one thread and sends once when the handler runs twice for a job", async () => {
		const input: FlueRunInput = {
			agent: "editor",
			message: "Once only.",
			kind: "reactive",
		};
		const before = booted.sidecar.requests.length;

		const job = handlerJob("job-twice");
		const first = await runHandler(booted, input, job);
		const second = await runHandler(booted, input, job);

		const thread = await threadOfJob(booted, job);

		expect(first).toEqual({
			thread: thread?.id,
			submissionId: thread?.["lastSubmissionId"],
			outcome: null,
		});
		expect(second).toEqual(first);
		expect(
			await booted.payload.count({
				collection: THREADS_SLUG,
				where: { dispatchJob: { equals: dispatchKey(job) } },
				overrideAccess: true,
			}),
		).toEqual({ totalDocs: 1 });
		expect(posts(before)).toHaveLength(1);
		expect(
			booted.sidecar.requests
				.slice(before)
				.filter((request) => request.path.includes("view=history")),
		).toEqual([]);
	});

	it("runs two jobs in a row as two threads when the second reuses the first's id", async () => {
		const before = booted.sidecar.requests.length;
		const first = await queueFlueRun(booted.payload, {
			agent: "editor",
			message: "First job.",
		});

		await booted.payload.jobs.run({ queue: "flue", overrideAccess: true });

		// SQLite hands the id of the deleted first job to the next one.
		const second = await queueFlueRun(booted.payload, {
			agent: "editor",
			message: "Second job.",
		});

		await booted.payload.jobs.run({ queue: "flue", overrideAccess: true });

		const threads = [
			await threadOfJob(booted, first),
			await threadOfJob(booted, second),
		];

		expect(second.id).toBe(first.id);
		expect(threads.map((thread) => thread?.["title"])).toEqual([
			"First job.",
			"Second job.",
		]);
		expect(posts(before)).toHaveLength(2);
	});

	it("a re-run whose thread has no submission sends nothing", async () => {
		const job = handlerJob("job-unsent");
		// A row as a run leaves it that ended between creating the thread and sending.
		const thread = await booted.payload.create({
			collection: THREADS_SLUG,
			data: {
				agent: "editor",
				kind: "reactive",
				conversationId: randomUUID(),
				handleHash: handleHash(randomUUID()),
				createdBy: { relationTo: "users", value: agentUser.id },
				dispatchJob: dispatchKey(job),
			},
			overrideAccess: true,
		});
		const warned = vi.spyOn(booted.payload.logger, "warn");
		const before = booted.sidecar.requests.length;

		try {
			const output = await runHandler(
				booted,
				{ agent: "editor", message: "Unsent.", kind: "reactive" },
				job,
			);

			expect(output).toEqual({
				thread: thread.id,
				submissionId: null,
				outcome: null,
			});
			expect(booted.sidecar.requests).toHaveLength(before);
			expect(warned).toHaveBeenCalledWith(
				expect.stringContaining("job-unsent"),
			);
		} finally {
			warned.mockRestore();
		}
	});

	it("a settled poke settles a dispatched thread nobody opened", async () => {
		const job = handlerJob("job-unwatched");

		booted.sidecar.submissionId = RECORDED_SUBMISSION;

		await runHandler(
			booted,
			{ agent: "editor", message: "Unwatched.", kind: "reactive" },
			job,
		);

		const running = await threadOfJob(booted, job);

		expect(running).toMatchObject({
			status: "running",
			lastSubmissionId: RECORDED_SUBMISSION,
		});

		const response = await send(booted, "/api/flue/settled", {
			method: "POST",
			body: {
				conversation: running?.["conversationId"],
				submissionId: RECORDED_SUBMISSION,
			},
			headers: { authorization: `Bearer ${SIDECAR_SECRET}` },
		});

		expect(response.status).toBe(204);
		expect(await threadOfJob(booted, job)).toMatchObject({
			status: "idle",
			title: "Secret word lookup",
		});
	});

	it("fails without the agent user and leaves no thread or upstream request", async () => {
		await booted.payload.update({
			collection: "users",
			id: agentUser.id,
			data: { email: `renamed-${randomUUID()}@example.com` },
			overrideAccess: true,
		});

		try {
			const threads = await count(booted, THREADS_SLUG);
			const requests = booted.sidecar.requests.length;
			const job = await queueFlueRun(booted.payload, {
				agent: "editor",
				message: "Nobody to act as.",
			});

			await booted.payload.jobs.run({ queue: "flue", overrideAccess: true });

			const failed = await findJob(booted, job.id);

			expect(failed["hasError"]).toBe(true);
			expect(JSON.stringify(failed)).toContain(
				`The agent user \\"${AGENT_EMAIL}\\" does not exist.`,
			);
			expect(await count(booted, THREADS_SLUG)).toBe(threads);
			expect(booted.sidecar.requests).toHaveLength(requests);
		} finally {
			await booted.payload.update({
				collection: "users",
				id: agentUser.id,
				data: { email: AGENT_EMAIL },
				overrideAccess: true,
			});
		}
	});

	it("refuses to queue an unknown agent and leaves no job", async () => {
		const jobs = await count(booted, JOBS);

		await expect(
			queueFlueRun(booted.payload, { agent: "nope", message: "Hi" }),
		).rejects.toThrow('unknown agent "nope"');
		expect(await count(booted, JOBS)).toBe(jobs);
	});

	it("schedules an ambient agent on its own queue and runs it as an ambient thread", async () => {
		const queue = "flue-digest";
		const { queued } = await booted.payload.jobs.handleSchedules({ queue });
		const { docs } = await booted.payload.find({
			collection: JOBS,
			where: { queue: { equals: queue } },
			depth: 0,
			overrideAccess: true,
		});
		const job = docs[0]!;

		expect(queued).toHaveLength(1);
		expect(docs).toHaveLength(1);
		expect(job["input"]).toEqual({
			agent: "digest",
			kind: "ambient",
			message: DIGEST.ambient?.message,
		});

		// The schedule queues the job for the cron's next second.
		const wait = Date.parse(job["waitUntil"] as string) - Date.now();

		await new Promise((resolve) => {
			setTimeout(resolve, Math.max(0, wait) + 50);
		});
		await booted.payload.jobs.run({ queue, overrideAccess: true });

		expect(
			await threadOfJob(booted, { id: job.id, createdAt: job["createdAt"] }),
		).toMatchObject({
			kind: "ambient",
			agent: "digest",
			createdBy: { relationTo: "users", value: agentUser.id },
		});
	});
});

// A workflow with two flue-dispatch steps, which share the job's dispatch key.
const TWO_DISPATCHES: WorkflowConfig = {
	slug: "two-dispatches",
	handler: async ({ tasks }) => {
		for (const step of ["first", "second"]) {
			// eslint-disable-next-line no-await-in-loop
			await tasks["flue-dispatch"]!(step, {
				input: { agent: "editor", message: `Step ${step}.`, kind: "reactive" },
			});
		}
	},
};

describe("flue-dispatch with dispatch.wait", () => {
	let booted: Booted;
	let agentUser: Doc;

	const input = (message: string): FlueRunInput => ({
		agent: "editor",
		message,
		kind: "reactive",
	});

	// A dispatched row as a run leaves it once it sent RECORDED_SUBMISSION.
	const recordedThread = (job: JobRef, status: string) =>
		booted.payload.create({
			collection: THREADS_SLUG,
			data: {
				agent: "editor",
				kind: "reactive",
				conversationId: randomUUID(),
				handleHash: handleHash(randomUUID()),
				createdBy: { relationTo: "users", value: agentUser.id },
				dispatchJob: dispatchKey(job),
				lastSubmissionId: RECORDED_SUBMISSION,
				flueUid: "inst_recorded",
				status,
			},
			overrideAccess: true,
		});

	beforeAll(async () => {
		({ booted, agentUser } = await bootWithAgentUser(
			"flue-dispatch-wait",
			{ agents: [EDITOR], dispatch: { wait: { maxWaitMs: 200 } } },
			{ jobs: { workflows: [TWO_DISPATCHES] } },
		));
	});

	beforeEach(() => {
		booted.sidecar.reset();
	});

	afterAll(async () => {
		await shutdown(booted);
	});

	it("waits for a completed run and settles its thread", async () => {
		const job = handlerJob("wait-completed");

		booted.sidecar.submissionId = RECORDED_SUBMISSION;

		const output = await runHandler(booted, input("Completes."), job);
		const thread = await threadOfJob(booted, job);

		expect(output).toEqual({
			thread: thread?.id,
			submissionId: RECORDED_SUBMISSION,
			outcome: "completed",
		});
		expect(thread).toMatchObject({ status: "idle" });
	});

	it("fails the job when the run does not settle in time and leaves it running", async () => {
		const job = handlerJob("wait-timeout");

		booted.sidecar.submissionId = RECORDED_SUBMISSION;
		booted.sidecar.history = "running";

		await expect(
			runHandler(booted, input("Never settles."), job),
		).rejects.toThrow("did not settle within 200 ms");
		expect(await threadOfJob(booted, job)).toMatchObject({
			status: "running",
		});
	});

	it("fails the job with Flue's reason when the run failed", async () => {
		const job = handlerJob("wait-failed");

		booted.sidecar.submissionId = RECORDED_SUBMISSION;
		booted.sidecar.history = "failed";

		await expect(runHandler(booted, input("Fails."), job)).rejects.toThrow(
			"failed: The model provider is unavailable.",
		);
		expect(await threadOfJob(booted, job)).toMatchObject({ status: "failed" });
	});

	it("a re-run waits for the recorded submission without sending", async () => {
		const job = handlerJob("wait-rerun");
		const thread = await recordedThread(job, "running");
		const sends = booted.sidecar.sends().length;

		const output = await runHandler(booted, input("Re-run."), job);

		expect(output).toEqual({
			thread: thread.id,
			submissionId: RECORDED_SUBMISSION,
			outcome: "completed",
		});
		expect(booted.sidecar.sends()).toHaveLength(sends);
		expect(await threadOfJob(booted, job)).toMatchObject({ status: "idle" });
	});

	it("a re-run after the thread was archived reports no outcome and sends nothing", async () => {
		const job = handlerJob("wait-archived");

		booted.sidecar.submissionId = RECORDED_SUBMISSION;
		booted.sidecar.history = "running";

		await expect(
			runHandler(booted, input("Archived later."), job),
		).rejects.toThrow("did not settle within 200 ms");

		const thread = await threadOfJob(booted, job);

		await booted.payload.update({
			collection: THREADS_SLUG,
			id: thread!.id,
			data: { status: "archived" },
			overrideAccess: true,
		});

		const sends = booted.sidecar.sends().length;
		const output = await runHandler(booted, input("Archived later."), job);

		expect(output).toEqual({
			thread: thread!.id,
			submissionId: RECORDED_SUBMISSION,
			outcome: null,
		});
		expect(booted.sidecar.sends()).toHaveLength(sends);
	});

	it("reports a run that settled before its thread was archived", async () => {
		const job = handlerJob("wait-settled-archived");
		const thread = await recordedThread(job, "archived");

		const output = await runHandler(booted, input("Settled first."), job);

		expect(output).toEqual({
			thread: thread.id,
			submissionId: RECORDED_SUBMISSION,
			outcome: "completed",
		});
	});

	it("refuses a second flue-dispatch step in one workflow job", async () => {
		const job = {
			...handlerJob("wait-workflow"),
			workflowSlug: "review",
			taskStatus: {
				"flue-dispatch": {
					first: { complete: true, taskSlug: "flue-dispatch", totalTried: 1 },
				},
			},
		};
		const sends = booted.sidecar.sends().length;

		await expect(
			runHandler(booted, input("Second step."), job),
		).rejects.toThrow("One flue-dispatch step per workflow job.");
		expect(booted.sidecar.sends()).toHaveLength(sends);
		expect(await threadOfJob(booted, job)).toBeUndefined();
	});

	it("fails the second flue-dispatch step of a real workflow run", async () => {
		booted.sidecar.submissionId = RECORDED_SUBMISSION;

		const sends = booted.sidecar.sends().length;
		const job = await booted.payload.jobs.queue({
			workflow: "two-dispatches",
			input: {},
			queue: "flue",
			overrideAccess: true,
		});

		await booted.payload.jobs.run({ queue: "flue", overrideAccess: true });

		const failed = await findJob(booted, job.id);
		const steps = (
			failed["taskStatus"] as Record<
				string,
				Record<string, { complete: boolean }>
			>
		)["flue-dispatch"];

		expect(failed["hasError"]).toBe(true);
		expect(steps?.["first"]?.complete).toBe(true);
		expect(steps?.["second"]?.complete).not.toBe(true);
		expect(JSON.stringify(failed)).toContain(
			"One flue-dispatch step per workflow job.",
		);
		expect(booted.sidecar.sends()).toHaveLength(sends + 1);
	});
});
