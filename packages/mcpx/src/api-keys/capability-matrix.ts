import {
	canCreate,
	canPublish,
	canWrite,
	CAPABILITIES_FIELD,
	isLiveWrite,
} from "../capabilities.js";

import type { NormalizedOptions } from "../options.js";
import type { McpxExposedEntity } from "../types.js";

/**
 * The group's `admin.description`, rendered by the matrix in Payload's
 * description slot. It explains both markings in the table: an unticked box
 * and a dash.
 */
export const CAPABILITIES_DESCRIPTION =
	"What this key may do. An unticked box is a refusal, and a dash means the plugin config does not expose that operation at all.";

/**
 * The operations a collection or global can expose. The generated checkboxes
 * and the matrix column headers share this wording.
 */
export const CAPABILITY_OPERATIONS = [
	{ id: "read", label: "Read", description: "Describe, find and read." },
	{
		id: "write",
		label: "Write",
		description: "Create, patch and validate drafts.",
	},
	{
		id: "publish",
		label: "Publish",
		description: "Promote the current draft to what the public sees.",
	},
] as const;

export type CapabilityOperation = (typeof CAPABILITY_OPERATIONS)[number]["id"];

/** The two entity namespaces, kept apart so slugs may collide across them. */
export type CapabilityNamespace = "collections" | "globals";

/**
 * One entity's row. The booleans say what the plugin config exposes, not what
 * the key was granted. A `false` renders as a dash, so absence reads as a
 * refusal by config rather than a gap.
 */
export interface CapabilityRow {
	fieldName: string;
	/** The slug, which is what MCP clients send and what refusals name. */
	label: string;
	read: boolean;
	write: boolean;
	publish: boolean;
	/** Said only where a row departs from what its column header promises. */
	hint?: string;
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

const UPLOAD_HINT = "Files are uploaded in the admin panel.";
const LIVE_HINT = "Writes go live immediately.";

/*
 * An upload collection's `write` reaches the document's own fields but never
 * `createDocument`, because no tool here carries a file. Without drafts a write
 * has no draft stage to land in.
 */
const hintFor = (entity: McpxExposedEntity): Pick<CapabilityRow, "hint"> => {
	const hints = [
		canWrite(entity) && !canCreate(entity) ? UPLOAD_HINT : undefined,
		isLiveWrite(entity) ? LIVE_HINT : undefined,
	].filter((hint) => hint !== undefined);

	return hints.length > 0 ? { hint: hints.join(" ") } : {};
};

const toRow = (entity: McpxExposedEntity): CapabilityRow => ({
	fieldName: entity.fieldName,
	label: entity.slug,
	read: entity.read,
	write: canWrite(entity),
	publish: canPublish(entity),
	...hintFor(entity),
});

/**
 * The single description of what the config exposes. `createCapabilityFields`
 * and the admin component both draw from it, so a cell cannot appear without a
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
	operation: CapabilityOperation,
): string => `${basePath}.${namespace}.${fieldName}.${operation}`;

export const toolPath = (basePath: string, name: string): string =>
	`${basePath}.tools.${name}`;

/** Every path the matrix can address, in a stable order. */
export const capabilityPaths = (
	matrix: CapabilityMatrix,
	basePath: string = CAPABILITIES_FIELD,
): string[] => [
	...(["collections", "globals"] as const).flatMap((namespace) =>
		matrix[namespace].flatMap((row) =>
			CAPABILITY_OPERATIONS.filter((operation) => row[operation.id]).map(
				(operation) =>
					cellPath(basePath, namespace, row.fieldName, operation.id),
			),
		),
	),
	...matrix.tools.map((tool) => toolPath(basePath, tool.name)),
];
