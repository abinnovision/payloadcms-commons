import type { PayloadRequest } from "payload";

/**
 * Whether a request originated from the MCP endpoint. The endpoint stamps
 * `req.context.mcpx`, which travels into every local API call made with the
 * same `req`, including those made by custom tools.
 */
export const isMcpxRequest = (req: PayloadRequest): boolean =>
	req.context.mcpx !== undefined;
