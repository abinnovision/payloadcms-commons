import {
	cellPath,
	rowOperations,
	toolPath,
} from "../api-keys/capability-matrix.js";
import {
	ACCESS_CHAIN,
	requiresOf,
	STORED_OPERATIONS,
} from "../capabilities.js";

import type {
	CapabilityMatrix,
	CapabilityNamespace,
	CapabilityRow,
} from "../api-keys/capability-matrix.js";
import type { StoredOperation } from "../capabilities.js";

/**
 * Form-state values, keyed by the same dotted paths the form uses.
 */
export type CapabilityValues = Record<string, boolean>;

/**
 * How far a key may go with an entity. Each level includes the ones before it.
 */
const ACCESS_LEVELS = ["none" as const, ...ACCESS_CHAIN.map(({ id }) => id)];

export type AccessLevel = (typeof ACCESS_LEVELS)[number];

/**
 * How a key may delete: not at all, with approval, or straight to trash.
 */
export type DeleteMode = "approve" | "off" | "trash";

export type ColumnState = "mixed" | "off" | "on";

interface CapabilityAction {
	type: "UPDATE";
	path: string;
	value: boolean;
}

/**
 * One click in the matrix. An access or delete intent without a `fieldName`
 * comes from a namespace's "All" control and applies to every row.
 */
export type ToggleIntent =
	| {
			kind: "access";
			namespace: CapabilityNamespace;
			fieldName?: string;
			level: AccessLevel;
	  }
	| {
			kind: "deleteMode";
			namespace: CapabilityNamespace;
			fieldName?: string;
			mode: DeleteMode;
	  }
	| { kind: "tool"; name: string; value: boolean }
	| { kind: "tools"; value: boolean };

const toolGranted = (
	values: CapabilityValues,
	basePath: string,
	name: string,
): boolean => values[toolPath(basePath, name)] === true;

const cellGranted = (
	values: CapabilityValues,
	basePath: string,
	namespace: CapabilityNamespace,
	row: CapabilityRow,
	operation: StoredOperation,
): boolean =>
	values[cellPath(basePath, namespace, row.fieldName, operation)] === true;

/**
 * One value per stored operation.
 */
const byOperation = <T>(
	valueOf: (operation: StoredOperation) => T,
): Record<StoredOperation, T> =>
	Object.fromEntries(
		STORED_OPERATIONS.map(({ id }) => [id, valueOf(id)]),
	) as Record<StoredOperation, T>;

export const toolsState = (
	matrix: CapabilityMatrix,
	basePath: string,
	values: CapabilityValues,
): ColumnState => {
	const granted = matrix.tools.filter((tool) =>
		toolGranted(values, basePath, tool.name),
	).length;

	if (granted === 0) {
		return "off";
	}

	return granted === matrix.tools.length ? "on" : "mixed";
};

/**
 * The levels a row offers: none, then each operation the config exposes.
 */
export const accessLevelsOf = (row: CapabilityRow): AccessLevel[] =>
	ACCESS_LEVELS.filter((level) => level === "none" || row[level]);

/**
 * The highest level whose flags are all granted, counting only operations the
 * config exposes. A write without a read reads as none, as on the server.
 */
export const accessLevelOf = (
	basePath: string,
	namespace: CapabilityNamespace,
	row: CapabilityRow,
	values: CapabilityValues,
): AccessLevel => {
	let reached: AccessLevel = "none";

	for (const { id } of ACCESS_CHAIN) {
		if (!row[id] || !cellGranted(values, basePath, namespace, row, id)) {
			break;
		}

		reached = id;
	}

	return reached;
};

/**
 * The delete mode a row's stored flags read as.
 */
export const deleteModeOf = (
	basePath: string,
	namespace: CapabilityNamespace,
	row: CapabilityRow,
	values: CapabilityValues,
): DeleteMode => {
	const granted = (operation: StoredOperation): boolean =>
		cellGranted(values, basePath, namespace, row, operation);

	// The server ignores a delete without read, so it reads as off.
	if (!granted("read") || !granted("delete")) {
		return "off";
	}

	return row.deleteUnattended && granted("deleteUnattended")
		? "trash"
		: "approve";
};

type StoredValues = Record<StoredOperation, boolean>;

// The operations a grant depends on, nearest first.
const prerequisitesOf = (operation: StoredOperation): StoredOperation[] => {
	const required = requiresOf(operation);

	return required ? [required, ...prerequisitesOf(required)] : [];
};

/*
 * Ticking an operation ticks what it needs, and clearing one clears what needs
 * it, which keeps the form from saving a combination the server ignores.
 */
const reconcile = (
	next: StoredValues,
	touched: ReadonlySet<StoredOperation>,
): StoredValues => {
	const result = { ...next };

	for (const operation of touched) {
		if (result[operation]) {
			for (const required of prerequisitesOf(operation)) {
				result[required] = true;
			}
		} else {
			for (const { id } of STORED_OPERATIONS) {
				if (prerequisitesOf(id).includes(operation)) {
					result[id] = false;
				}
			}
		}
	}

	return result;
};

const rowActions = (
	basePath: string,
	namespace: CapabilityNamespace,
	row: CapabilityRow,
	values: CapabilityValues,
	changes: Partial<StoredValues>,
): CapabilityAction[] => {
	const current = byOperation((operation) =>
		cellGranted(values, basePath, namespace, row, operation),
	);

	const touched = new Set<StoredOperation>();
	const next = { ...current };

	// A change to an operation the config does not expose has nowhere to go.
	for (const operation of rowOperations(row)) {
		const change = changes[operation.id];

		if (change !== undefined) {
			next[operation.id] = change;
			touched.add(operation.id);
		}
	}

	const reconciled = reconcile(next, touched);

	return rowOperations(row)
		.filter((operation) => reconciled[operation.id] !== current[operation.id])
		.map((operation) => ({
			type: "UPDATE" as const,
			path: cellPath(basePath, namespace, row.fieldName, operation.id),
			value: reconciled[operation.id],
		}));
};

// A level grants its own operation and every one before it.
const grantsOf = (level: AccessLevel): Partial<StoredValues> => {
	const rank = ACCESS_LEVELS.indexOf(level);

	return Object.fromEntries(ACCESS_CHAIN.map(({ id }, i) => [id, rank > i]));
};

/**
 * The form-state updates one click implies, as literal actions. Every click
 * comes through here, so the dependency rules apply to the "All" controls too:
 * picking Write ticks read, and lowering access to none clears delete.
 *
 * Only cells whose value changes get an action, so a click that changes
 * nothing does not mark the form modified. A level above a row's ceiling
 * grants what the row exposes and no more.
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
				(tool) => toolGranted(values, basePath, tool.name) !== intent.value,
			)
			.map((tool) => ({
				type: "UPDATE" as const,
				path: toolPath(basePath, tool.name),
				value: intent.value,
			}));
	}

	const rows = matrix[intent.namespace].filter(
		(row) =>
			intent.fieldName === undefined || row.fieldName === intent.fieldName,
	);

	const changes: Partial<StoredValues> =
		intent.kind === "access"
			? grantsOf(intent.level)
			: {
					delete: intent.mode !== "off",
					deleteUnattended: intent.mode === "trash",
				};

	return rows.flatMap((row) =>
		rowActions(basePath, intent.namespace, row, values, changes),
	);
};

// The first candidate whose intent would change nothing.
const firstNoop = <T>(
	candidates: readonly T[],
	matrix: CapabilityMatrix,
	basePath: string,
	values: CapabilityValues,
	intentOf: (candidate: T) => ToggleIntent,
): T | undefined =>
	candidates.find(
		(candidate) =>
			buildToggleActions(matrix, basePath, values, intentOf(candidate))
				.length === 0,
	);

/**
 * The level a namespace's "All" control shows: the one that would change
 * nothing if picked, so rows capped below it still count. `undefined` while
 * the rows differ.
 */
export const allAccessLevel = (
	matrix: CapabilityMatrix,
	basePath: string,
	namespace: CapabilityNamespace,
	values: CapabilityValues,
): AccessLevel | undefined =>
	firstNoop(ACCESS_LEVELS, matrix, basePath, values, (level) => ({
		kind: "access",
		namespace,
		level,
	}));

/**
 * The delete mode the "All" control shows, by the same rule. It offers no
 * trash, so a row that trashes directly reads as mixed.
 */
export const allDeleteMode = (
	matrix: CapabilityMatrix,
	basePath: string,
	namespace: CapabilityNamespace,
	values: CapabilityValues,
): DeleteMode | undefined =>
	firstNoop(["off", "approve"] as const, matrix, basePath, values, (mode) => ({
		kind: "deleteMode",
		namespace,
		mode,
	}));
