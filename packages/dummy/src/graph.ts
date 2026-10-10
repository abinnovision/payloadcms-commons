import { fail } from "./errors.js";

import type { DummySeed } from "./types.js";

/*
 * Recovers one concrete cycle from the nodes the sort could not place. The
 * unplaced set does not tell an operator what to change; a path does.
 */
const findCycle = (
	remaining: readonly DummySeed[],
): readonly string[] | undefined => {
	const edges = new Map(
		remaining.map((seed) => [
			seed.id,
			(seed.dependsOn ?? []).filter((id) =>
				remaining.some((it) => it.id === id),
			),
		]),
	);
	const onPath = new Set<string>();
	const settled = new Set<string>();
	const path: string[] = [];

	const visit = (id: string): readonly string[] | undefined => {
		if (onPath.has(id)) {
			return [...path.slice(path.indexOf(id)), id];
		}

		if (settled.has(id)) {
			return undefined;
		}

		onPath.add(id);
		path.push(id);

		for (const next of edges.get(id) ?? []) {
			const found = visit(next);

			if (found) {
				return found;
			}
		}

		onPath.delete(id);
		settled.add(id);
		path.pop();

		return undefined;
	};

	for (const seed of remaining) {
		const found = visit(seed.id);

		if (found) {
			return found;
		}
	}

	return undefined;
};

/**
 * Orders seeds so every seed runs after the ones it depends on.
 *
 * Kahn's algorithm in declaration order, so the run is reproducible and a diff
 * of the reported order means a real change.
 *
 * @param seeds The declared seeds, in declaration order.
 */
export const sortSeeds = (
	seeds: readonly DummySeed[],
): readonly DummySeed[] => {
	const byId = new Map<string, DummySeed>();

	for (const seed of seeds) {
		if (seed.id === "") {
			fail("A seed has an empty id.");
		}

		if (byId.has(seed.id)) {
			fail(`Seed id "${seed.id}" is declared twice.`);
		}

		byId.set(seed.id, seed);
	}

	const declared = [...byId.keys()].join(", ");

	for (const seed of seeds) {
		for (const id of seed.dependsOn ?? []) {
			if (!byId.has(id)) {
				fail(
					`Seed "${seed.id}" depends on "${id}", which is not declared. ` +
						`Declared seeds: ${declared}.`,
				);
			}
		}
	}

	const pending = new Map(
		seeds.map((seed) => [seed.id, new Set(seed.dependsOn ?? [])]),
	);
	const sorted: DummySeed[] = [];

	while (sorted.length < seeds.length) {
		/*
		 * Scanned in declaration order rather than pulled from a queue, so two
		 * independent seeds always come out in the order they were written.
		 */
		const next = seeds.find(
			(seed) => pending.get(seed.id)?.size === 0 && !sorted.includes(seed),
		);

		if (!next) {
			break;
		}

		sorted.push(next);
		pending.delete(next.id);

		for (const waiting of pending.values()) {
			waiting.delete(next.id);
		}
	}

	if (sorted.length !== seeds.length) {
		const remaining = seeds.filter((seed) => !sorted.includes(seed));
		const cycle = findCycle(remaining)?.join(" -> ") ?? remaining[0]?.id;

		fail(
			`Seed dependency cycle: ${String(cycle)}.\n` +
				"Remove one dependsOn. A ref that points at a seed running later does " +
				"not need an edge; it is written on the replay pass instead.",
		);
	}

	return sorted;
};

/**
 * Narrows a sorted run to the named seeds, keeping their order.
 *
 * Dependencies are not pulled in: a ref falls back to the database, which is
 * what makes running one seed against an already seeded database useful.
 *
 * @param sorted The seeds in run order.
 * @param only The ids to keep, or undefined to keep all.
 */
export const selectSeeds = (
	sorted: readonly DummySeed[],
	only: readonly string[] | undefined,
): readonly DummySeed[] => {
	if (!only || only.length === 0) {
		return sorted;
	}

	for (const id of only) {
		if (!sorted.some((seed) => seed.id === id)) {
			fail(
				`No seed named "${id}". Declared seeds: ` +
					`${sorted.map((seed) => seed.id).join(", ")}.`,
			);
		}
	}

	return sorted.filter((seed) => only.includes(seed.id));
};
