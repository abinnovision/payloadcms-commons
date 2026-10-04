import {
	cellPath,
	STORED_OPERATIONS,
	toolPath,
} from "../api-keys/capability-matrix.js";

import type {
	CapabilityMatrix,
	CapabilityNamespace,
	CapabilityRow,
	StoredOperation,
} from "../api-keys/capability-matrix.js";

/**
 * Form-state values, keyed by the same dotted paths the form uses.
 */
export type CapabilityValues = Record<string, boolean>;

/**
 * How far a key may go with an entity. Each level includes the ones before it.
 */
const ACCESS_LEVELS = ["none", "read", "write", "publish"] as const;

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

export const toolsState = (
	matrix: CapabilityMatrix,
	basePath: string,
	values: CapabilityValues,
): ColumnState => {
	const granted = matrix.tools.filter(
		(tool) => values[toolPath(basePath, tool.name)] === true,
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

	for (const level of ACCESS_LEVELS) {
		if (level === "none") {
			continue;
		}

		if (
			!row[level] ||
			values[cellPath(basePath, namespace, row.fieldName, level)] !== true
		) {
			break;
		}

		reached = level;
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
		values[cellPath(basePath, namespace, row.fieldName, operation)] === true;

	// The server ignores a delete without read, so it reads as off.
	if (!granted("read") || !granted("delete")) {
		return "off";
	}

	return row.deleteUnattended && granted("deleteUnattended")
		? "trash"
		: "approve";
};

type StoredValues = Record<StoredOperation, boolean>;

/*
 * What each operation depends on, taken from the operations themselves.
 * `resolveCapabilities` discards a grant whose prerequisite is off.
 */
const requiresOf = (
	operation: StoredOperation,
): StoredOperation | undefined => {
	const found = STORED_OPERATIONS.find(
		(candidate) => candidate.id === operation,
	);

	return found && "requires" in found ? found.requires : undefined;
};

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
	const current = Object.fromEntries(
		STORED_OPERATIONS.map((operation) => [
			operation.id,
			values[cellPath(basePath, namespace, row.fieldName, operation.id)] ===
				true,
		]),
	) as StoredValues;

	const touched = new Set<StoredOperation>();
	const next = { ...current };

	for (const operation of STORED_OPERATIONS) {
		const change = changes[operation.id];

		// A change to an operation the config does not expose has nowhere to go.
		if (change !== undefined && row[operation.id]) {
			next[operation.id] = change;
			touched.add(operation.id);
		}
	}

	const reconciled = reconcile(next, touched);

	return STORED_OPERATIONS.filter(
		(operation) =>
			row[operation.id] && reconciled[operation.id] !== current[operation.id],
	).map((operation) => ({
		type: "UPDATE" as const,
		path: cellPath(basePath, namespace, row.fieldName, operation.id),
		value: reconciled[operation.id],
	}));
};

// A level grants its own operation and every one before it.
const grantsOf = (level: AccessLevel): Partial<StoredValues> => {
	const rank = ACCESS_LEVELS.indexOf(level);

	return { read: rank >= 1, write: rank >= 2, publish: rank >= 3 };
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
	ACCESS_LEVELS.find(
		(level) =>
			buildToggleActions(matrix, basePath, values, {
				kind: "access",
				namespace,
				level,
			}).length === 0,
	);

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
	(["off", "approve"] as const).find(
		(mode) =>
			buildToggleActions(matrix, basePath, values, {
				kind: "deleteMode",
				namespace,
				mode,
			}).length === 0,
	);
