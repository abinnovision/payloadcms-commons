import { z } from "zod";

import type {
	McpxAnyTool,
	McpxTool,
	McpxToolConfirm,
	McpxToolDefinition,
	McpxToolScope,
} from "./types.js";

/**
 * Fixed shape; arguments inferred from it.
 */
export function defineMcpxTool<
	Shape extends z.ZodRawShape,
	Confirm extends McpxToolConfirm | undefined = undefined,
>(
	tool: McpxToolDefinition<Shape, z.infer<z.ZodObject<Shape>>, Confirm> & {
		inputSchema?: Shape;
	},
): McpxTool<Shape>;
/**
 * Per-request shape returned as an object literal; arguments inferred from it.
 */
export function defineMcpxTool<
	Shape extends z.ZodRawShape,
	Confirm extends McpxToolConfirm | undefined = undefined,
>(
	tool: McpxToolDefinition<Shape, z.infer<z.ZodObject<Shape>>, Confirm> & {
		inputSchema: (scope: McpxToolScope) => Shape;
	},
): McpxAnyTool;
/**
 * Per-request shape built from helpers that erase to `z.ZodRawShape`, as the
 * builtins do. Nothing to infer from, so state the arguments instead.
 */
export function defineMcpxTool<
	Args,
	Confirm extends McpxToolConfirm | undefined = undefined,
>(
	tool: McpxToolDefinition<z.ZodRawShape, Args, Confirm> & {
		inputSchema: (scope: McpxToolScope) => z.ZodRawShape;
	},
): McpxAnyTool;
export function defineMcpxTool(tool: McpxAnyTool): McpxAnyTool {
	return tool;
}

/**
 * Strict, so an unknown argument is rejected by name instead of stripped.
 */
export const toolInputSchema = (
	tool: McpxAnyTool,
	scope: McpxToolScope,
): z.ZodObject =>
	z.strictObject(
		typeof tool.inputSchema === "function"
			? tool.inputSchema(scope)
			: (tool.inputSchema ?? {}),
	);

/**
 * A tool that does not decide for itself is gated by its own checkbox.
 */
export const isToolEnabled = (
	tool: McpxAnyTool,
	scope: McpxToolScope,
): boolean =>
	tool.isEnabled
		? tool.isEnabled(scope)
		: scope.capabilities.tools[tool.name] === true;
