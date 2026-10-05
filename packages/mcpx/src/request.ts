import type { PayloadRequest } from "payload";

/**
 * Whether `req` came through the MCP endpoint, which stamps `req.context.mcpx`.
 * The stamp follows `req` into every local API call, including custom tools.
 */
export const isMcpxRequest = (req: PayloadRequest): boolean =>
	req.context.mcpx !== undefined;

/**
 * The origin links to this server use: `serverURL` when set, else that of the
 * MCP request.
 */
export const publicOrigin = (req: PayloadRequest): string =>
	req.payload.config.serverURL || new URL(req.url ?? "").origin;
