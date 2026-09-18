import {
	canCreate,
	canPublish,
	canWrite,
	CAPABILITIES_FIELD,
} from "../capabilities.js";

import type { NormalizedOptions } from "../options.js";
import type { McpxExposedEntity } from "../types.js";

/**
 * The group's `admin.description`, which the matrix renders in Payload's own
 * description slot under the heading. It is the one place the two markings in
 * the table are explained, so both belong in it.
 */
export const CAPABILITIES_DESCRIPTION =
	"What this key may do. An unticked box is a refusal, and a dash means the plugin config does not expose that operation at all.";

/**
 * The three operations a collection or global can expose, described once. The
 * generated checkboxes and the matrix column headers both read these, so the
 * wording a key's owner sees cannot drift from what the field config carries.
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
 * One entity's row. The three booleans say what the plugin config exposes, not
 * what the key has been granted: a `false` renders as a dash rather than an
 * empty box, so absence reads as a refusal by config rather than a gap.
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

export interface CapabilityTool {
	name: string;
	description: string;
}

/**
 * Everything the admin component needs to draw the matrix, derived from the
 * plugin options at config time. Crosses the server/client boundary as a client
 * prop, so every leaf has to stay JSON-serializable.
 */
export interface CapabilityMatrix {
	collections: CapabilityRow[];
	globals: CapabilityRow[];
	tools: CapabilityTool[];
}

/** Form-state values, keyed by the same dotted paths the form uses. */
export type CapabilityValues = Record<string, boolean>;

export type ColumnState = "mixed" | "off" | "on";

export interface CapabilityAction {
	type: "UPDATE";
	path: string;
	value: boolean;
}

export type ToggleIntent =
	| {
			kind: "cell";
			namespace: CapabilityNamespace;
			fieldName: string;
			operation: CapabilityOperation;
			value: boolean;
	  }
	| {
			kind: "column";
			namespace: CapabilityNamespace;
			operation: CapabilityOperation;
			value: boolean;
	  }
	| {
			kind: "row";
			namespace: CapabilityNamespace;
			fieldName: string;
			value: boolean;
	  }
	| { kind: "tool"; name: string; value: boolean }
	| { kind: "tools"; value: boolean };

const UPLOAD_HINT = "Files are uploaded in the admin panel.";

const toRow = (entity: McpxExposedEntity): CapabilityRow => ({
	fieldName: entity.fieldName,
	label: entity.slug,
	read: entity.read,
	write: canWrite(entity),
	publish: canPublish(entity),
	/*
	 * An upload collection's `write` reaches the document's own fields but never
	 * `createDocument`, because no tool here carries a file.
	 */
	...(canWrite(entity) && !canCreate(entity) ? { hint: UPLOAD_HINT } : {}),
});

/**
 * The single description of what the config exposes. `createCapabilityFields`
 * generates its checkboxes from this, and the admin component draws from it, so
 * a cell can never appear without a field behind it.
 */
export const createCapabilityMatrix = (
	options: NormalizedOptions,
): CapabilityMatrix => ({
	collections: options.collections.map(toRow),
	globals: options.globals.map(toRow),
	/*
	 * A description built per request has no scope at config time, so the row
	 * falls back to the tool's name.
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

const stateOf = (paths: string[], values: CapabilityValues): ColumnState => {
	if (paths.length === 0) {
		return "off";
	}

	const granted = paths.filter((path) => values[path] === true).length;

	if (granted === 0) {
		return "off";
	}

	return granted === paths.length ? "on" : "mixed";
};

/**
 * Whether a column's bulk toggle reads as on, off or indeterminate. Non-exposed
 * cells are ignored: a column of two granted cells and one dash is fully on.
 */
export const columnState = (
	matrix: CapabilityMatrix,
	basePath: string,
	namespace: CapabilityNamespace,
	operation: CapabilityOperation,
	values: CapabilityValues,
): ColumnState =>
	stateOf(
		matrix[namespace]
			.filter((row) => row[operation])
			.map((row) => cellPath(basePath, namespace, row.fieldName, operation)),
		values,
	);

/**
 * Whether an entity's row toggle reads as on, off or indeterminate, over the
 * operations the config exposes for that row.
 */
export const rowState = (
	basePath: string,
	namespace: CapabilityNamespace,
	row: CapabilityRow,
	values: CapabilityValues,
): ColumnState =>
	stateOf(
		CAPABILITY_OPERATIONS.filter((operation) => row[operation.id]).map(
			(operation) => cellPath(basePath, namespace, row.fieldName, operation.id),
		),
		values,
	);

export const toolsState = (
	matrix: CapabilityMatrix,
	basePath: string,
	values: CapabilityValues,
): ColumnState =>
	stateOf(
		matrix.tools.map((tool) => toolPath(basePath, tool.name)),
		values,
	);

/**
 * Publishing is an extension of writing, and `publishFlag` in `capabilities.ts`
 * discards a publish without a write. Ticking publish therefore ticks write,
 * and clearing write clears publish, so the form cannot save a combination the
 * server ignores.
 */
const reconcile = (
	next: Record<CapabilityOperation, boolean>,
	touched: ReadonlySet<CapabilityOperation>,
): Record<CapabilityOperation, boolean> => {
	if (touched.has("publish") && next.publish) {
		return { ...next, write: true };
	}

	if (touched.has("write") && !next.write) {
		return { ...next, publish: false };
	}

	return next;
};

const rowActions = (
	basePath: string,
	namespace: CapabilityNamespace,
	row: CapabilityRow,
	values: CapabilityValues,
	changes: Partial<Record<CapabilityOperation, boolean>>,
): CapabilityAction[] => {
	const current = {
		read: values[cellPath(basePath, namespace, row.fieldName, "read")] === true,
		write:
			values[cellPath(basePath, namespace, row.fieldName, "write")] === true,
		publish:
			values[cellPath(basePath, namespace, row.fieldName, "publish")] === true,
	};

	const touched = new Set<CapabilityOperation>();
	const next = { ...current };

	for (const operation of CAPABILITY_OPERATIONS) {
		const change = changes[operation.id];

		/* A change to an operation the config does not expose has nowhere to go. */
		if (change !== undefined && row[operation.id]) {
			next[operation.id] = change;
			touched.add(operation.id);
		}
	}

	const reconciled = reconcile(next, touched);

	return CAPABILITY_OPERATIONS.filter(
		(operation) =>
			row[operation.id] && reconciled[operation.id] !== current[operation.id],
	).map((operation) => ({
		type: "UPDATE" as const,
		path: cellPath(basePath, namespace, row.fieldName, operation.id),
		value: reconciled[operation.id],
	}));
};

/**
 * The form-state updates one click implies, as literal actions. Every toggle in
 * the matrix — cell, row, column or tool — comes through here, so the publish
 * rule holds for bulk grants as much as for a single box.
 *
 * Only cells whose value actually changes get an action, which keeps a bulk
 * toggle from marking the form modified when it changes nothing.
 */
export const buildToggleActions = (
	matrix: CapabilityMatrix,
	basePath: string,
	values: CapabilityValues,
	intent: ToggleIntent,
): CapabilityAction[] => {
	if (intent.kind === "tool" || intent.kind === "tools") {
		return matrix.tools
			.filter((tool) => intent.kind === "tools" || tool.name === intent.name)
			.filter(
				(tool) =>
					(values[toolPath(basePath, tool.name)] === true) !== intent.value,
			)
			.map((tool) => ({
				type: "UPDATE" as const,
				path: toolPath(basePath, tool.name),
				value: intent.value,
			}));
	}

	const rows = matrix[intent.namespace].filter(
		(row) => intent.kind === "column" || row.fieldName === intent.fieldName,
	);

	const changes: Partial<Record<CapabilityOperation, boolean>> =
		intent.kind === "row"
			? { read: intent.value, write: intent.value, publish: intent.value }
			: { [intent.operation]: intent.value };

	return rows.flatMap((row) =>
		rowActions(basePath, intent.namespace, row, values, changes),
	);
};
