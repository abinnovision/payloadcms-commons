export { defineMcpxTool } from "./define-tool.js";
export { mcpxPlugin } from "./plugin.js";
export { isMcpxRequest } from "./request.js";
export { errorResult, jsonResult } from "./result.js";
export { strategyAuthOf, withMcpxAuth } from "./strategy.js";
export { mcpxReadRequest } from "./tools/read-request.js";

export type { DocumentId as McpxDocumentId } from "./entity.js";
export type { McpxStrategyAuth } from "./strategy.js";
export type {
	McpxAnyTool,
	McpxAuthResult,
	McpxCapabilities,
	McpxCapabilityGrant,
	McpxCollectionOptions,
	McpxEntityCapabilities,
	McpxExposedEntity,
	McpxGlobalOptions,
	McpxPluginOptions,
	McpxRequestContext,
	McpxResolvedCapabilities,
	McpxScopeSlugs,
	McpxTool,
	McpxToolExtra,
	McpxToolScope,
} from "./types.js";
