import { createContextExtension } from "../context.js";
import { planPass, planRootOnly } from "./plan.js";

import type { BlockContext, InternalBlockEntry } from "../types.js";

interface ResultsStore {
	/**
	 * Node identity -> resolved data. A `Map`, not a `WeakMap`: contexts are
	 *  per-request and short-lived, so nothing here outlives the request.
	 */
	results: Map<object, unknown>;
	/**
	 * Nodes whose resolver declared `expands`, tracked so a later call can
	 *  still traverse their stored result even though the node itself is
	 *  already resolved (the accumulating store's skip-execution-only rule).
	 */
	expandsFrontier: Set<object>;
}

const resultsExtension =
	createContextExtension<ResultsStore>("resolve-results");

const getStore = (ctx: BlockContext<unknown>): ResultsStore => {
	let store = resultsExtension.get(ctx);
	if (!store) {
		store = { results: new Map(), expandsFrontier: new Set() };
		resultsExtension.set(ctx, store);
	}

	return store;
};

const isDev = (): boolean => process.env["NODE_ENV"] !== "production";

/**
 * Raw store lookup. No warning: use `checkIdentity` at a render or access
 * site for that. `D` lets callers narrow the return type explicitly.
 */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters
export const getBlockData = <D>(
	ctx: BlockContext<unknown>,
	node: object,
): D | undefined => {
	return resultsExtension.get(ctx)?.results.get(node) as D | undefined;
};

/**
 * Dev-mode identity-violation warning. `node`'s `blockType` has a registered
 * resolver, but the store holds no entry for this exact object reference.
 * That means the block was spread or cloned after resolving, which montage's
 * identity-keyed store cannot follow. Called from both render dispatch and
 * the public `getBlockData` accessor, since the exposure applies to both
 * resolve-to-render and resolve-to-use.
 */
export const checkIdentity = (
	ctx: BlockContext<unknown>,
	node: unknown,
	entries: ReadonlyMap<string, InternalBlockEntry>,
): void => {
	if (!isDev()) {
		return;
	}

	if (typeof node !== "object" || node === null) {
		return;
	}

	const blockType = (node as { blockType?: unknown }).blockType;
	if (typeof blockType !== "string") {
		return;
	}

	const entry = entries.get(blockType);
	if (!entry?.resolve) {
		return;
	}

	const store = resultsExtension.get(ctx);
	if (store?.results.has(node)) {
		return;
	}

	// eslint-disable-next-line no-console -- dev-only identity-violation diagnostic.
	console.error(
		`montage: block "${blockType}" has a registered resolver but no resolved data for this ` +
			`object. Do not spread or clone a block between resolving and rendering; montage matches ` +
			`results by object identity.`,
	);
};

export const resolveBlockData = async (args: {
	root: object;
	ctx: BlockContext<unknown>;
	entries: ReadonlyMap<string, InternalBlockEntry>;
	scope?: "root" | "tree" | undefined;
	maxPasses?: number | undefined;
}): Promise<void> => {
	const { root, ctx, entries, scope = "tree", maxPasses = 3 } = args;
	const store = getStore(ctx);

	const runExecutions = async (
		executions: { node: Record<string, unknown>; entry: InternalBlockEntry }[],
	): Promise<void> => {
		await Promise.all(
			executions.map(async ({ node, entry }) => {
				try {
					const data = await entry.resolve?.({ block: node, ctx });
					store.results.set(node, data);
				} catch (error) {
					/*
					 * A rejected resolver leaves this node's data `undefined` and never
					 * fails the render or the pass, in any environment.
					 */
					store.results.set(node, undefined);
					if (isDev()) {
						// eslint-disable-next-line no-console -- dev-only resolver-failure diagnostic.
						console.error(
							`montage: resolver for block "${entry.slug}" rejected.`,
							error,
						);
					}
				}

				if (entry.expands) {
					store.expandsFrontier.add(node);
				}
			}),
		);
	};

	if (scope === "root") {
		await runExecutions(planRootOnly(root, entries, store.results));

		return;
	}

	/*
	 * scope: "tree". Pass 1 traverses `root`. Later passes traverse only the
	 * stored results of resolvers that declared `expands`, iterating up to
	 * `maxPasses`. A node already resolved is skipped for execution, but if
	 * it declared `expands`, its stored result is still traversed here so a
	 * `scope: "root"` call followed by `scope: "tree"` still expands the
	 * document resolver's result even though the document node itself is
	 * already resolved.
	 */
	let frontier: unknown[] = [root];
	for (const node of store.expandsFrontier) {
		frontier.push(store.results.get(node));
	}

	let pass = 0;
	while (frontier.length > 0) {
		pass += 1;
		if (pass > maxPasses) {
			const message = `montage: resolveBlockData exceeded maxPasses (${String(maxPasses)}).`;
			if (isDev()) {
				throw new Error(message);
			}

			/**
			 * Production fallback: warn and stop rather than crash, since with
			 * `expands` the pass count is content-dependent.
			 */
			// eslint-disable-next-line no-console
			console.error(`${message} Stopping.`);

			return;
		}

		const executions = planPass(frontier, entries, store.results);
		/**
		 * Passes are inherently sequential: a later pass's frontier is derived
		 * from this pass's results. Within-pass work is already parallel via
		 * `Promise.all` in `runExecutions`.
		 */
		// eslint-disable-next-line no-await-in-loop
		await runExecutions(executions);

		const nextFrontier: unknown[] = [];
		for (const { node, entry } of executions) {
			if (entry.expands) {
				nextFrontier.push(store.results.get(node));
			}
		}

		frontier = nextFrontier;
	}
};
