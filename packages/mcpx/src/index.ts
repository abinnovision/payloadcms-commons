export { defineMcpxTool } from "./define-tool.js";
export { mcpxPlugin } from "./plugin.js";
export { isMcpxRequest } from "./request.js";
export { errorResult, jsonResult } from "./result.js";

export type { DocumentId as McpxDocumentId } from "./entity.js";
export type {
	McpxAnyTool,
	McpxAuthResult,
	McpxCollectionCapabilities,
	McpxCollectionOptions,
	McpxExposedEntity,
	McpxGlobalOptions,
	McpxPluginOptions,
	McpxRequestContext,
	McpxResolvedCapabilities,
	McpxScopeSlugs,
	McpxTool,
	McpxToolExtra,
	McpxToolScope,
	McpxWriteMode,
} from "./types.js";
