import type { NormalizedOptions } from "../options.js";
import type { McpxResolvedCapabilities } from "../types.js";
import type {
	CallToolResult,
	ToolAnnotations,
} from "@modelcontextprotocol/sdk/types.js";
import type { PayloadRequest } from "payload";
import type { z } from "zod";

/**
 * Everything a tool needs about the current request: the authenticated
 * request, the plugin options and what this key may touch.
 */
interface ToolScope {
	req: PayloadRequest;
	options: NormalizedOptions;
	capabilities: McpxResolvedCapabilities;
	/** Collection slugs the key may read / write. */
	readable: string[];
	writable: string[];
	/** Global slugs the key may read / write. */
	readableGlobals: string[];
	writableGlobals: string[];
	/** Configured locale codes, or `null` when localization is off. */
	locales: null | string[];
	defaultLocale: null | string;
}

/**
 * A builtin tool. Its input shape depends on the scope (which collections and
 * locales the key may use), so the shape is built per request.
 */
interface BuiltinTool<Args = Record<string, unknown>> {
	name: string;
	description: string;
	annotations: ToolAnnotations;
	isEnabled: (scope: ToolScope) => boolean;
	inputSchema: (scope: ToolScope) => z.ZodRawShape;
	// Method syntax keeps the handler bivariant so tools with concrete
	// argument types are assignable to `BuiltinTool[]`.
	// eslint-disable-next-line @typescript-eslint/method-signature-style
	handler(args: Args, scope: ToolScope): Promise<CallToolResult>;
}

export type { BuiltinTool, ToolScope };
