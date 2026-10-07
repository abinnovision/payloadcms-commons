import { CAPABILITIES_FIELD, STORED_OPERATIONS } from "../capabilities.js";

import type { StoredOperation } from "../capabilities.js";
import type { NormalizedOptions } from "../options.js";
import type { McpxEntityCapabilities, McpxExposedEntity } from "../types.js";

/**
 * The group's `admin.description`, rendered by the matrix in Payload's
 * description slot. It explains how to read the controls.
 */
export const CAPABILITIES_DESCRIPTION =
	"What this key may do. Each level includes the ones before it, and a missing segment means the plugin config does not expose it. A shield means this key's user approves each call.";

/**
 * The two entity namespaces, kept apart so slugs may collide across them.
 */
export type CapabilityNamespace = "collections" | "globals";

/**
 * One entity's row. The booleans say what the plugin config exposes, not what
 * the key was granted. A `false` leaves its segment out of the row's controls.
 */
export interface CapabilityRow extends McpxEntityCapabilities {
	fieldName: string;
	/**
	 * The slug, which is what MCP clients send and what refusals name.
	 */
	slug: string;
	/**
	 * Writes go live immediately, as the entity keeps no drafts.
	 */
	live?: boolean;
}

interface CapabilityTool {
	name: string;
	description: string;
}

/**
 * Everything the admin component needs to draw the matrix, derived from the
 * plugin options at config time. Passed as a client prop, so every leaf must be
 * JSON-serializable.
 */
export interface CapabilityMatrix {
	collections: CapabilityRow[];
	globals: CapabilityRow[];
	tools: CapabilityTool[];
}

const toRow = (entity: McpxExposedEntity): CapabilityRow => ({
	fieldName: entity.fieldName,
	slug: entity.slug,
	read: entity.read,
	write: entity.write,
	publish: entity.publish,
	delete: entity.delete,
	deleteUnattended: entity.deleteUnattended,
	...(entity.liveWrite ? { live: true } : {}),
});

/**
 * The operations a row exposes, in stored order.
 */
export const rowOperations = (
	row: CapabilityRow,
): (typeof STORED_OPERATIONS)[number][] =>
	STORED_OPERATIONS.filter((operation) => row[operation.id]);

/**
 * The single description of what the config exposes. `createCapabilityFields`
 * and the admin component both draw from it, so a control cannot appear without a
 * field behind it.
 */
export const createCapabilityMatrix = (
	options: NormalizedOptions,
): CapabilityMatrix => ({
	collections: options.collections.map(toRow),
	globals: options.globals.map(toRow),
	/*
	 * A description built per request has no scope at config time, so the row
	 * falls back to the tool name.
	 */
	tools: options.tools.map((tool) => ({
		name: tool.name,
		description:
			typeof tool.description === "string" ? tool.description : tool.name,
	})),
});

export const cellPath = (
	basePath: string,
	namespace: CapabilityNamespace,
	fieldName: string,
	operation: StoredOperation,
): string => `${basePath}.${namespace}.${fieldName}.${operation}`;

export const toolPath = (basePath: string, name: string): string =>
	`${basePath}.tools.${name}`;

/**
 * Every path the matrix can address, in a stable order.
 */
export const capabilityPaths = (
	matrix: CapabilityMatrix,
	basePath: string = CAPABILITIES_FIELD,
): string[] => [
	...(["collections", "globals"] as const).flatMap((namespace) =>
		matrix[namespace].flatMap((row) =>
			rowOperations(row).map((operation) =>
				cellPath(basePath, namespace, row.fieldName, operation.id),
			),
		),
	),
	...matrix.tools.map((tool) => toolPath(basePath, tool.name)),
];
