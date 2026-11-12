import type { FluePluginOptions } from "./types.js";

export { fluePlugin } from "./plugin.js";
export { DISPATCH_TASK } from "./jobs/dispatch.js";
export { flueQueues, queueFlueRun } from "./jobs/queue.js";

export type { FlueRunOutput } from "./jobs/dispatch.js";
export type { QueueFlueRunArgs } from "./jobs/queue.js";
export type { ChatContext, RunKind } from "./protocol/context.js";
export type {
	AttachmentMimeType,
	FlueAgentConfig,
	FlueAttachmentOptions,
	FlueCapabilities,
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
