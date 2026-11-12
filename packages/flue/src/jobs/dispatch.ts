import { ValidationError } from "payload";

import { awaitSettlement } from "./settle.js";
import { startTurn } from "../turn.js";

import type { SettlementOutcome } from "../protocol/events.js";
import type {
	PluginSettings,
	ThreadDoc,
	TurnResult,
	TurnUser,
} from "../turn.js";
import type { FlueRunInput } from "../types.js";
import type { DefaultDocumentIDType, TaskConfig } from "payload";

type ScheduleConfig = NonNullable<TaskConfig["schedule"]>[number];

/** The slug of the job task that runs reactive and ambient turns. */
export const DISPATCH_TASK = "flue-dispatch";

/** What a `flue-dispatch` job outputs. */
export interface FlueRunOutput {
	thread: DefaultDocumentIDType;
	submissionId: null | string;
	/**
	 * How the run settled while the job waited (`dispatch.wait`). `null` when
	 * waiting is off, nothing was sent, or the thread was archived or deleted
	 * before the run settled.
	 */
	outcome: Exclude<SettlementOutcome, "failed"> | null;
}

/** The queue of an agent's ambient runs, one per agent. */
export const ambientQueue = (agent: string): string => `flue-${agent}`;

const agentUserMissing = (email: string | undefined): string =>
	email === undefined
		? "[payloadcms-flue] flue-dispatch needs the agentUser option, the user reactive and ambient runs act as."
		: `[payloadcms-flue] The agent user "${email}" does not exist. Create it before flue runs are queued.`;

/**
 * The `flue-dispatch` task: starts a reactive or ambient turn as the agent
 * user. A job re-run after its lease lapsed finds its thread by the job id
 * and sends at most once. With `dispatch.wait`, the job waits for the run to
 * settle, and a re-run waits for the submission it recorded. Ambient agents
 * get a schedule on their own queue.
 */
export const createDispatchTask = (
	settings: PluginSettings,
): TaskConfig<{ input: FlueRunInput; output: FlueRunOutput }> => {
	const { userCollection } = settings.mcpx;

	const schedule = settings.agents.flatMap((agent): ScheduleConfig[] => {
		const { ambient } = agent;

		if (!ambient) {
			return [];
		}

		const input: FlueRunInput = {
			agent: agent.slug,
			kind: "ambient",
			message: ambient.message,
		};

		return [
			{
				cron: ambient.cron,
				queue: ambientQueue(agent.slug),
				hooks: {
					beforeSchedule: async (args) => ({
						...(await args.defaultBeforeSchedule(args)),
						input,
					}),
				},
			},
		];
	});

	return {
		slug: DISPATCH_TASK,
		retries: 0,
		...(schedule.length > 0 ? { schedule } : {}),
		handler: async ({ input, job, req }) => {
			// Every step of one workflow job shares the job's dispatch key.
			if (
				job.workflowSlug &&
				Object.values(job.taskStatus[DISPATCH_TASK] ?? {}).some(
					(step) => step.complete,
				)
			) {
				throw new Error(
					"[payloadcms-flue] One flue-dispatch step per workflow job.",
				);
			}

			const { payload } = req;
			const agent = settings.agents.find(
				(candidate) => candidate.slug === input.agent,
			);

			if (!agent) {
				throw new Error(
					`[payloadcms-flue] flue-dispatch got the unknown agent "${input.agent}".`,
				);
			}

			const email = settings.agentUser?.email;
			const { docs } =
				email === undefined
					? { docs: [] }
					: await payload.find({
							collection: userCollection,
							where: { email: { equals: email } },
							limit: 1,
							depth: 0,
							overrideAccess: true,
							req,
						});
			const agentUser = docs[0];

			if (!agentUser) {
				throw new Error(agentUserMissing(email));
			}

			// Found documents carry no collection, without which authorship records no owner.
			const user: TurnUser = { ...agentUser, collection: userCollection };
			// SQLite reuses the id of a deleted job; a re-run of the same job keeps its creation time.
			const dispatchJob = `${String(job.id)}@${job.createdAt}`;
			const byJob = async (): Promise<ThreadDoc | undefined> =>
				(
					await payload.find({
						collection: settings.threads.slug,
						where: { dispatchJob: { equals: dispatchJob } },
						limit: 1,
						depth: 0,
						overrideAccess: true,
						showHiddenFields: true,
						req,
					})
				).docs[0] as ThreadDoc | undefined;
			/*
			 * The job's thread exists already, so nothing is sent again. A row
			 * without a submission is still being sent by another run, or its
			 * run ended between creating it and sending.
			 */
			const recorded = (thread: ThreadDoc): TurnResult => {
				if (!thread.lastSubmissionId) {
					payload.logger.warn(
						`[payloadcms-flue] flue-dispatch job ${dispatchJob} found its thread without a submission and sends nothing.`,
					);
				}

				return {
					thread,
					offset: undefined,
					submissionId: thread.lastSubmissionId ?? undefined,
				};
			};

			const existing = await byJob();
			let result: TurnResult;

			if (existing) {
				result = recorded(existing);
			} else {
				try {
					result = await startTurn(req, settings, {
						agent,
						user,
						message: input.message,
						context: input.context ?? {},
						kind: input.kind,
						onBehalfOf: input.onBehalfOf,
						dispatchJob,
					});
				} catch (error) {
					// A concurrent run of the same job created the row first.
					const raced =
						error instanceof ValidationError ? await byJob() : undefined;

					if (!raced) {
						throw error;
					}

					result = recorded(raced);
				}
			}

			const { wait } = settings.dispatch;
			const settlement =
				wait && result.submissionId !== undefined
					? await awaitSettlement(
							req,
							settings,
							result.thread.id,
							result.submissionId,
							wait,
						)
					: null;

			if (settlement?.outcome === "failed") {
				const reason =
					settlement.error?.message ??
					settlement.error?.type ??
					"no error recorded";

				throw new Error(
					`[payloadcms-flue] flue-dispatch run ${settlement.submissionId} of thread ${String(result.thread.id)} failed: ${reason}`,
				);
			}

			return {
				output: {
					thread: result.thread.id,
					submissionId: result.submissionId ?? null,
					outcome: settlement?.outcome ?? null,
				},
			};
		},
	};
};
