import type { InternalBlockEntry } from "../types.js";

export interface PlannedExecution {
	node: Record<string, unknown>;
	entry: InternalBlockEntry;
}

/** Minimal interface satisfied by both `Map` and `WeakMap`. */
export interface ResolvedLookup {
	has: (node: object) => boolean;
}

const hasBlockType = (
	value: unknown,
): value is Record<string, unknown> & { blockType: string } =>
	typeof value === "object" &&
	value !== null &&
	typeof (value as { blockType?: unknown }).blockType === "string";

/**
 * Blind traversal: descends arrays, plain objects, richtext subtrees and
 * populated relationship values alike. There is no structural way to
 * recognise a relationship boundary without the field schema, so fan-out is
 * bounded by `expands` alone, not by excluding any shape here.
 */
const collectBlockNodes = (
	value: unknown,
	visited: WeakSet<object>,
	out: (Record<string, unknown> & { blockType: string })[],
): void => {
	if (value === null || typeof value !== "object") {
		return;
	}

	if (visited.has(value)) {
		return;
	}

	visited.add(value);

	if (hasBlockType(value)) {
		out.push(value);
	}

	if (Array.isArray(value)) {
		for (const item of value) {
			collectBlockNodes(item, visited, out);
		}

		return;
	}

	for (const entry of Object.values(value)) {
		collectBlockNodes(entry, visited, out);
	}
};

/**
 * Builds the execution set for one traversal pass over `frontier`. Nodes
 * already present in `alreadyResolved` are skipped, which is the
 * dedup half of the accumulating-store contract in `execute.ts`.
 */
export const planPass = (
	frontier: readonly unknown[],
	entries: ReadonlyMap<string, InternalBlockEntry>,
	alreadyResolved: ResolvedLookup,
): PlannedExecution[] => {
	const visited = new WeakSet<object>();
	const nodes: (Record<string, unknown> & { blockType: string })[] = [];

	for (const root of frontier) {
		collectBlockNodes(root, visited, nodes);
	}

	const executions: PlannedExecution[] = [];
	for (const node of nodes) {
		if (alreadyResolved.has(node)) {
			continue;
		}

		const entry = entries.get(node.blockType);
		if (!entry?.resolve) {
			continue;
		}

		executions.push({ node, entry });
	}

	return executions;
};

/** `scope: "root"` — checks only the root node, does not traverse, ignores `expands`. */
export const planRootOnly = (
	root: unknown,
	entries: ReadonlyMap<string, InternalBlockEntry>,
	alreadyResolved: ResolvedLookup,
): PlannedExecution[] => {
	if (!hasBlockType(root)) {
		return [];
	}

	if (alreadyResolved.has(root)) {
		return [];
	}

	const entry = entries.get(root.blockType);
	if (!entry?.resolve) {
		return [];
	}

	return [{ node: root, entry }];
};
