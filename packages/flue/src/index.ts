import type { FluePluginOptions } from "./types.js";

export { fluePlugin } from "./plugin.js";
export { flueThreadScoped } from "./files/scope.js";
export { defaultDeliver } from "./protocol/attachments.js";
export { DISPATCH_TASK } from "./jobs/dispatch.js";
export { flueQueues, queueFlueRun } from "./jobs/queue.js";

export type { FlueRunOutput } from "./jobs/dispatch.js";
export type { QueueFlueRunArgs } from "./jobs/queue.js";
export type { ChatContext, RunKind } from "./protocol/context.js";
export type {
	FileDeliver,
	FileDelivery,
	FlueAgentConfig,
	FlueCapabilities,
	FlueFileOptions,
	FlueCollectionGrant,
	FlueGlobalGrant,
	FluePluginOptions,
	FlueRequestContext,
	FlueRunInput,
} from "./types.js";

declare module "payload" {
	interface RegisteredPlugins {
		"@abinnovision/payloadcms-flue": FluePluginOptions;
	}
}
