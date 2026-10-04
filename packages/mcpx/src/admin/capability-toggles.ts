import {
	CAPABILITY_OPERATIONS,
	cellPath,
	toolPath,
} from "../api-keys/capability-matrix.js";

import type {
	CapabilityMatrix,
	CapabilityNamespace,
	CapabilityOperation,
	CapabilityRow,
} from "../api-keys/capability-matrix.js";

/**
 * Form-state values, keyed by the same dotted paths the form uses.
 */
export type CapabilityValues = Record<string, boolean>;

export type ColumnState = "mixed" | "off" | "on";

interface CapabilityAction {
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
 * Whether a column's bulk toggle reads as on, off or indeterminate. Cells the
 * config does not expose are ignored: two granted cells and one dash read as on.
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

// A row toggle never grants a delete, which each key opts into on its own.
const ROW_OPERATIONS = CAPABILITY_OPERATIONS.filter(
	(operation) =>
		operation.id !== "delete" && operation.id !== "deleteUnattended",
);

/**
 * Whether an entity's row toggle reads as on, off or indeterminate, over the
 * operations the config exposes for that row, deletes aside.
 */
export const rowState = (
	basePath: string,
	namespace: CapabilityNamespace,
	row: CapabilityRow,
	values: CapabilityValues,
): ColumnState =>
	stateOf(
		ROW_OPERATIONS.filter((operation) => row[operation.id]).map((operation) =>
			cellPath(basePath, namespace, row.fieldName, operation.id),
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

/*
 * `resolveCapabilities` discards a publish without a write, a delete without
 * a read and an unattended delete without a delete. So ticking one ticks what
 * it needs, and clearing one clears what needs it, which keeps the form from
 * saving a combination the server ignores.
 */
const reconcile = (
	next: Record<CapabilityOperation, boolean>,
	touched: ReadonlySet<CapabilityOperation>,
): Record<CapabilityOperation, boolean> => {
	let result = next;

	if (touched.has("publish") && result.publish) {
		result = { ...result, write: true };
	}

	if (touched.has("write") && !result.write) {
		result = { ...result, publish: false };
	}

	if (touched.has("deleteUnattended") && result.deleteUnattended) {
		result = { ...result, delete: true };
	}

	if (
		(touched.has("delete") || touched.has("deleteUnattended")) &&
		result.delete
	) {
		result = { ...result, read: true };
	}

	if (touched.has("read") && !result.read) {
		result = { ...result, delete: false };
	}

	if ((touched.has("delete") || touched.has("read")) && !result.delete) {
		result = { ...result, deleteUnattended: false };
	}

	return result;
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
		delete:
			values[cellPath(basePath, namespace, row.fieldName, "delete")] === true,
		deleteUnattended:
			values[
				cellPath(basePath, namespace, row.fieldName, "deleteUnattended")
			] === true,
	};

	const touched = new Set<CapabilityOperation>();
	const next = { ...current };

	for (const operation of CAPABILITY_OPERATIONS) {
		const change = changes[operation.id];

		// A change to an operation the config does not expose has nowhere to go.
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
 * The form-state updates one click implies, as literal actions. Every toggle
 * (cell, row, column or tool) comes through here, so the publish rule applies
 * to bulk grants too.
 *
 * Only cells whose value changes get an action, so a bulk toggle that changes
 * nothing does not mark the form modified.
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
