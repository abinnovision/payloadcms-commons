import type { McpxCapabilities } from "./types.js";

// A symbol cannot come from a database row or JSON, so stored data cannot forge it.
const AUTH = Symbol.for("@abinnovision/payloadcms-mcpx/auth");

/**
 * The format of a principal a strategy attaches. It always contains a colon,
 * which a document id never does, so it cannot collide with an API key's.
 */
export const STRATEGY_PRINCIPAL = /^[a-z][a-z0-9-]*:[A-Za-z0-9_-]+$/;

/** Whether `value` is a principal in the {@link STRATEGY_PRINCIPAL} format. */
export const isStrategyPrincipal = (value: unknown): value is string =>
	typeof value === "string" && STRATEGY_PRINCIPAL.test(value);

/**
 * What a Payload auth strategy hands to mcpx with its user.
 */
export interface McpxStrategyAuth {
	/**
	 * What confirmations and upload grants are bound to, such as
	 * `my-agent:42`. Must match {@link STRATEGY_PRINCIPAL}.
	 */
	principal: string;
	capabilities: McpxCapabilities;
}

/**
 * Returns `user` with MCP auth attached, for a Payload auth strategy to
 * return. The MCP endpoint then acts as that user with `capabilities`, capped
 * by the plugin config. A copy keeps the attachment, JSON serialisation drops it.
 */
export const withMcpxAuth = <User extends object>(
	user: User,
	auth: McpxStrategyAuth,
): User => ({ ...user, [AUTH]: auth });

/**
 * The auth a strategy attached to `user` with {@link withMcpxAuth}, or
 * `undefined`. Only server code can attach it, so its presence marks a
 * request that carries MCP capabilities.
 */
export const strategyAuthOf = (user: unknown): McpxStrategyAuth | undefined =>
	typeof user === "object" && user !== null
		? (user as { [AUTH]?: McpxStrategyAuth })[AUTH]
		: undefined;
