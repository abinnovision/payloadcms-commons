import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

import { relationId } from "./auth/resolve.js";
import { resolveCapabilities, storedCapabilities } from "./capabilities.js";
import { actAs } from "./endpoint/handler.js";
import { createMcpServer } from "./endpoint/server.js";
import { optionsOf } from "./plugin.js";
import { createLocalRequest } from "./request.js";
import { MCPX_VERSION } from "./version.js";

import type { McpxCapabilityGrant, McpxUser } from "./types.js";
import type { Payload } from "payload";

/**
 * What one entity grants, keyed by operation. Deleting is not offered here.
 */
export interface McpxLocalEntityCapabilities {
	read?: boolean;
	write?: boolean;
	publish?: boolean;
}

/**
 * What an in-process client may do, keyed by collection slug, global slug and
 * tool name. The plugin config caps it the same way it caps an API key.
 */
export interface McpxLocalCapabilities {
	collections?: Record<string, McpxLocalEntityCapabilities>;
	globals?: Record<string, McpxLocalEntityCapabilities>;
	tools?: Record<string, boolean>;
}

// Turns off any `delete` a caller passes despite the type.
const withoutDelete = (
	granted: Record<string, McpxLocalEntityCapabilities> | undefined,
): Record<string, McpxCapabilityGrant> =>
	Object.fromEntries(
		Object.entries(granted ?? {}).map(([slug, operations]) => [
			slug,
			{ ...operations, delete: false },
		]),
	);

/**
 * An MCP client connected in process to the tools of the plugin installed on
 * `payload`, acting as `user` with `capabilities`. The caller vouches for
 * `user`: no API key is checked, and Payload's access control runs as that
 * user. Without a key there is nothing to approve or upload against, so
 * deletes, uploads and confirmations are unavailable. `close` also closes the
 * server.
 */
export const createMcpxClient = async (
	payload: Payload,
	args: { user: McpxUser; capabilities: McpxLocalCapabilities },
): Promise<Client> => {
	const options = optionsOf(payload);
	const { user, capabilities } = args;

	if (
		relationId(user) === undefined ||
		user.collection !== options.userCollection
	) {
		throw new Error(
			`[payloadcms-mcpx] createMcpxClient needs a user of the "${options.userCollection}" collection with an id.`,
		);
	}

	const req = await createLocalRequest(payload, user);
	const scope = actAs(req, options, user, {
		capabilities: resolveCapabilities(
			options,
			storedCapabilities(options, {
				...capabilities,
				collections: withoutDelete(capabilities.collections),
				globals: withoutDelete(capabilities.globals),
			}),
		),
	});
	const server = createMcpServer({ ...scope, uploads: false }, options);
	const client = new Client({ name: "mcpx-local", version: MCPX_VERSION });
	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();

	await server.connect(serverTransport);
	await client.connect(clientTransport);

	return client;
};
