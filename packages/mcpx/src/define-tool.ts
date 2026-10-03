import type { McpxAnyTool, McpxTool, McpxToolScope } from "./types.js";
import type { z } from "zod";

/**
 * Fixed shape; arguments inferred from it.
 */
export function defineMcpxTool<Shape extends z.ZodRawShape>(
	tool: McpxTool<Shape> & { inputSchema?: Shape },
): McpxTool<Shape>;
/**
 * Per-request shape returned as an object literal; arguments inferred from it.
 */
export function defineMcpxTool<Shape extends z.ZodRawShape>(
	tool: McpxTool<Shape> & {
		inputSchema: (scope: McpxToolScope) => Shape;
	},
): McpxAnyTool;
/**
 * Per-request shape built from helpers that erase to `z.ZodRawShape`, as the
 * builtins do. Nothing to infer from, so state the arguments instead.
 */
export function defineMcpxTool<Args>(
	tool: McpxTool<z.ZodRawShape, Args> & {
		inputSchema: (scope: McpxToolScope) => z.ZodRawShape;
	},
): McpxAnyTool;
export function defineMcpxTool(tool: McpxAnyTool): McpxAnyTool {
	return tool;
}
