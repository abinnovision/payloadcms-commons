import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createLocalReq } from "payload";

import { relationId } from "./auth/resolve.js";
import { resolveCapabilities } from "./capabilities.js";
import { actAs } from "./endpoint/handler.js";
import { createMcpServer } from "./endpoint/server.js";
import { ownValue } from "./guards.js";
import { optionsOf } from "./plugin.js";
import { MCPX_VERSION } from "./version.js";

import type { McpxExposedEntity } from "./types.js";
import type { Payload, TypedUser } from "payload";

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

// The slug-keyed grants in the shape of a key's stored capability group.
const storedGroup = (
	entities: McpxExposedEntity[],
	granted: Record<string, McpxLocalEntityCapabilities> | undefined,
): Record<string, unknown> =>
	Object.fromEntries(
		entities.map((entity) => {
			const operations = ownValue(granted, entity.slug);

			return [
				entity.fieldName,
				{
					read: operations?.read,
					write: operations?.write,
					publish: operations?.publish,
				},
			];
		}),
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
	args: { user: TypedUser; capabilities: McpxLocalCapabilities },
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

	const req = await createLocalReq({ user }, payload);
	const scope = actAs(req, options, user, {
		capabilities: resolveCapabilities(options, {
			collections: storedGroup(options.collections, capabilities.collections),
			globals: storedGroup(options.globals, capabilities.globals),
			tools: capabilities.tools,
		}),
	});
	const server = createMcpServer({ ...scope, uploads: false }, options);
	const client = new Client({ name: "mcpx-local", version: MCPX_VERSION });
	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();

	await server.connect(serverTransport);
	await client.connect(clientTransport);

	return client;
};
