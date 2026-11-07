import * as payloadModule from "payload";

import type { McpxUser } from "./types.js";
import type { Payload, PayloadRequest, RequestContext } from "payload";

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

// Loosely typed: the two majors export different signatures under these names.
const exported = payloadModule as unknown as {
	createLocalReq: (
		options: { user: McpxUser; context?: RequestContext },
		payload: Payload,
	) => Promise<PayloadRequest>;
	createPayloadRequest: (args: {
		payload: Payload;
		user: McpxUser;
		context?: RequestContext;
	}) => Promise<PayloadRequest>;
};

/**
 * A local request acting as `user`. Payload 3 exposes `createLocalReq`, Payload
 * 4 replaced it with `createPayloadRequest`; the module's exports decide.
 */
export const createLocalRequest = async (
	payload: Payload,
	user: McpxUser,
	context?: RequestContext,
): Promise<PayloadRequest> => {
	const extra = context && { context };

	if ("createLocalReq" in payloadModule) {
		return await exported.createLocalReq({ user, ...extra }, payload);
	}

	return await exported.createPayloadRequest({ payload, user, ...extra });
};
