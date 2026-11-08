import { ambientQueue, DISPATCH_TASK } from "./dispatch.js";
import { DISPATCH_QUEUE } from "../options.js";

import type { FluePluginOptions, FlueRunInput } from "../types.js";
import type { Payload, PayloadRequest } from "payload";

/** Where the plugin leaves what `queueFlueRun` reads, on `config.custom`. */
export const QUEUE_SETTINGS_KEY = "@abinnovision/payloadcms-flue";

/** What `queueFlueRun` reads from the sanitized config. */
export interface QueueSettings {
	queue: string;
	agents: string[];
}

export interface QueueFlueRunArgs {
	/** The slug of the agent to run. */
	agent: string;
	message: string;
	/** The user whose action triggered the run. */
	onBehalfOf?: FlueRunInput["onBehalfOf"];
	/** The document the run is about. */
	context?: FlueRunInput["context"];
	/** The caller's request, so the job is queued in its transaction. */
	req?: PayloadRequest;
}

/**
 * Queues a reactive run of `agent` on the dispatch queue, for example from
 * a collection hook. Server-side callers are trusted: the agent's `access`
 * is not checked. Throws for an agent the plugin does not know.
 */
export const queueFlueRun = async (
	payload: Payload,
	{ agent, message, onBehalfOf, context, req }: QueueFlueRunArgs,
) => {
	const settings = payload.config.custom[QUEUE_SETTINGS_KEY] as
		QueueSettings | undefined;

	if (!settings) {
		throw new Error(
			"[payloadcms-flue] queueFlueRun needs the flue plugin in the Payload config.",
		);
	}

	if (!settings.agents.includes(agent)) {
		throw new Error(
			`[payloadcms-flue] queueFlueRun got the unknown agent "${agent}".`,
		);
	}

	const input: FlueRunInput = {
		agent,
		message,
		kind: "reactive",
		...(onBehalfOf === undefined ? {} : { onBehalfOf }),
		...(context === undefined ? {} : { context }),
	};

	return await payload.jobs.queue({
		task: DISPATCH_TASK,
		queue: settings.queue,
		input,
		overrideAccess: true,
		...(req === undefined ? {} : { req }),
	});
};

/**
 * Every queue flue jobs run on: the dispatch queue and one per ambient
 * agent. Give each its own `jobs.autoRun` entry, or run them in a worker.
 */
export const flueQueues = (options: FluePluginOptions): string[] => [
	options.dispatch?.queue ?? DISPATCH_QUEUE,
	...options.agents
		.filter((agent) => agent.ambient)
		.map((agent) => ambientQueue(agent.slug)),
];
