import { isDummyRef } from "./ref.js";
import { isPlainObject, isRichTextState } from "./walk.js";

import type { DummyDocumentId, DummyRef } from "./types.js";

/*
 * Marks a value whose ref could not be resolved yet. It bubbles outward until
 * an array drops the element holding it or a document drops the field, so
 * nothing half-built reaches Payload.
 */
const TAINTED = Symbol("dummy.tainted");

type Resolver = (ref: DummyRef) => DummyDocumentId | undefined;

/** Every ref token in a structure, in the order the walk meets them. */
export const collectRefs = (value: unknown): readonly DummyRef[] => {
	const found: DummyRef[] = [];

	const walk = (node: unknown): void => {
		if (isDummyRef(node)) {
			found.push(node);

			return;
		}

		if (Array.isArray(node)) {
			node.forEach(walk);

			return;
		}

		if (isPlainObject(node)) {
			Object.values(node).forEach(walk);
		}
	};

	walk(value);

	return found;
};

export interface AppliedRefs<T> {
	/** The data with every resolvable ref substituted and the rest pruned. */
	value: T;
	/** The refs that could not be resolved, so the caller can queue a replay. */
	unresolved: readonly DummyRef[];
}

/**
 * Substitutes every resolvable ref and prunes what is left.
 *
 * The prunable unit is the nearest enclosing array element, or the top-level
 * field, with a rich text state treated as one value so a lone unresolved link
 * node cannot leave a paragraph without its visible text.
 *
 * @param data The data as the seed wrote it, tokens included.
 * @param resolve Answers a ref's document id, or undefined if not yet written.
 */
export const applyRefs = <T>(data: T, resolve: Resolver): AppliedRefs<T> => {
	const unresolved: DummyRef[] = [];

	/*
	 * Walks a plain object's entries. A nested object bubbles its taint outward,
	 * so the nearest enclosing array drops the whole element. The document at the
	 * top does not: it drops the tainted field and keeps the rest, which is what
	 * leaves the natural key in place for the replay to find.
	 */
	const walkEntries = (
		node: Record<string, unknown>,
		bubble: boolean,
	): Record<string, unknown> | typeof TAINTED => {
		const next: Record<string, unknown> = {};
		let tainted = false;

		for (const [key, value] of Object.entries(node)) {
			const resolved = walk(value);

			if (resolved === TAINTED) {
				tainted = true;

				continue;
			}

			next[key] = resolved;
		}

		return tainted && bubble ? TAINTED : next;
	};

	const walk = (node: unknown): unknown => {
		if (isDummyRef(node)) {
			const id = resolve(node);

			if (id === undefined) {
				unresolved.push(node);

				return TAINTED;
			}

			return node.__dummyRef === "polymorphic"
				? { relationTo: node.collection, value: id }
				: id;
		}

		// A Date is the one non-plain value seed data carries.
		if (node instanceof Date) {
			return node;
		}

		if (Array.isArray(node)) {
			const kept: unknown[] = [];

			for (const entry of node) {
				const next = walk(entry);

				if (next !== TAINTED) {
					kept.push(next);
				}
			}

			return kept;
		}

		if (!isPlainObject(node)) {
			return node;
		}

		/*
		 * A rich text state is opaque. One unresolved ref anywhere inside taints
		 * the whole value, so the field is absent from this write and present on
		 * the replay, rather than keeping a paragraph that lost its link node.
		 */
		if (isRichTextState(node)) {
			const pending = collectRefs(node).filter(
				(ref) => resolve(ref) === undefined,
			);

			if (pending.length > 0) {
				unresolved.push(...pending);

				return TAINTED;
			}
		}

		return walkEntries(node, true);
	};

	const top = isPlainObject(data) ? walkEntries(data, false) : walk(data);

	return {
		value: (top === TAINTED ? {} : top) as T,
		unresolved,
	};
};
