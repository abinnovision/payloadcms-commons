import { useCallback, useEffect, useRef, useState } from "react";

import { keysetOf } from "./keyset.js";

import type { ThreadDoc, ThreadPage, ThreadState } from "./api.js";
import type { Keyset } from "./keyset.js";

/** Loads one page of a thread list, continuing after `after`. */
export type PageLoader = (after?: Keyset) => Promise<ThreadPage>;

/** A thread list the panel pages itself, for search and runs. */
export interface ThreadPages {
	rows: ThreadDoc[];
	loading: boolean;
	loadingMore: boolean;
	hasMore: boolean;
	error: unknown;
	loadMoreError: unknown;
	loadMore: () => void;
	/** Loads the failed page again. */
	retry: () => void;
	/** Loads the list again from the first page. */
	refresh: () => void;
	/** Takes the status and message time the poll read. */
	patch: (states: readonly ThreadState[]) => void;
}

interface PagesState {
	rows: ThreadDoc[];
	loading: boolean;
	loadingMore: boolean;
	hasMore: boolean;
	error: unknown;
	loadMoreError: unknown;
}

const EMPTY: PagesState = {
	rows: [],
	loading: false,
	loadingMore: false,
	hasMore: false,
	error: undefined,
	loadMoreError: undefined,
};

// The state with a loaded page: the first replaces the rows, a later one appends.
const withPage = (
	current: PagesState,
	page: ThreadPage,
	first: boolean,
): PagesState => {
	const known = new Set(current.rows.map((row) => String(row.id)));
	const rows = first
		? page.docs
		: [
				...current.rows,
				...page.docs.filter((row) => !known.has(String(row.id))),
			];
	const last = rows.at(-1);

	return {
		...current,
		rows,
		loading: false,
		loadingMore: false,
		hasMore:
			page.hasNextPage && last !== undefined && keysetOf(last) !== undefined,
	};
};

/**
 * The pages `load` returns, from the first. A new `load` starts over and
 * drops the answers of the previous one; without one the list is empty.
 * `onRows` receives every loaded page.
 */
export const useThreadPages = (
	load: PageLoader | undefined,
	onRows: (rows: ThreadDoc[]) => void,
): ThreadPages => {
	const [state, setState] = useState<PagesState>(EMPTY);
	const generation = useRef(0);
	const busy = useRef(false);
	const rowsSeen = useRef(onRows);

	rowsSeen.current = onRows;

	// A refresh keeps the rows on screen until the first page answers.
	const fetchPage = useCallback(
		(after: Keyset | undefined, refresh = false) => {
			if (load === undefined) {
				return;
			}

			if (after === undefined) {
				generation.current += 1;
			}

			const run = generation.current;

			busy.current = true;
			setState((current) => {
				if (after !== undefined) {
					return { ...current, loadingMore: true, loadMoreError: undefined };
				}

				return refresh
					? { ...current, loading: true, loadingMore: false, error: undefined }
					: { ...EMPTY, loading: true };
			});
			load(after).then(
				(page) => {
					if (run !== generation.current) {
						return;
					}

					busy.current = false;
					rowsSeen.current(page.docs);
					setState((current) => withPage(current, page, after === undefined));
				},
				(error: unknown) => {
					if (run !== generation.current) {
						return;
					}

					busy.current = false;
					setState((current) =>
						after === undefined
							? { ...current, loading: false, error }
							: { ...current, loadingMore: false, loadMoreError: error },
					);
				},
			);
		},
		[load],
	);

	useEffect(() => {
		if (load === undefined) {
			generation.current += 1;
			busy.current = false;
			setState(EMPTY);

			return;
		}

		fetchPage(undefined);
	}, [load, fetchPage]);

	// Answers that arrive after unmount are dropped like superseded ones.
	useEffect(
		() => () => {
			generation.current += 1;
		},
		[],
	);

	const { rows, hasMore, error, loadMoreError } = state;

	const loadMore = useCallback(() => {
		const last = rows.at(-1);
		const after = last === undefined ? undefined : keysetOf(last);

		if (busy.current || !hasMore || after === undefined) {
			return;
		}

		fetchPage(after);
	}, [rows, hasMore, fetchPage]);

	const retry = useCallback(() => {
		if (error !== undefined) {
			fetchPage(undefined);
		} else if (loadMoreError !== undefined) {
			loadMore();
		}
	}, [error, loadMoreError, fetchPage, loadMore]);

	const refresh = useCallback(() => {
		fetchPage(undefined, true);
	}, [fetchPage]);

	const patch = useCallback((states: readonly ThreadState[]) => {
		const byId = new Map(states.map((entry) => [String(entry.id), entry]));

		setState((current) => ({
			...current,
			rows: current.rows.map((row) => {
				const read = byId.get(String(row.id));

				return read === undefined
					? row
					: {
							...row,
							status: read.status,
							lastMessageAt: read.lastMessageAt ?? null,
						};
			}),
		}));
	}, []);

	return { ...state, loadMore, retry, refresh, patch };
};
