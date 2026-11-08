import type { ThreadId } from "./api.js";

/** A row reads as stale once it has run this long without a message. */
export const STALE_AFTER_MS = 2 * 60 * 1000;

/** A row is read again at most this often. */
export const RECHECK_AFTER_MS = 5 * 60 * 1000;

/** At most this many rows are read at a time. */
export const STALE_MAX = 3;

/** What the choice reads of a listed thread. */
export interface RunningRow {
	id: ThreadId;
	status: string;
	lastMessageAt?: null | string;
}

/**
 * The rows whose settlement may have been missed: still `running` with a
 * last message older than {@link STALE_AFTER_MS}, and not read within
 * {@link RECHECK_AFTER_MS} according to `seen` (thread id to the time it was
 * last read). At most {@link STALE_MAX}, in list order.
 */
export const staleRunning = (
	rows: readonly RunningRow[],
	now: number,
	seen: ReadonlyMap<string, number>,
): string[] => {
	const picked: string[] = [];

	for (const row of rows) {
		if (picked.length === STALE_MAX) {
			break;
		}

		const id = String(row.id);
		const lastMessageAt =
			typeof row.lastMessageAt === "string"
				? Date.parse(row.lastMessageAt)
				: Number.NaN;
		const readAt = seen.get(id);

		if (
			row.status === "running" &&
			now - lastMessageAt > STALE_AFTER_MS &&
			(readAt === undefined || now - readAt >= RECHECK_AFTER_MS) &&
			!picked.includes(id)
		) {
			picked.push(id);
		}
	}

	return picked;
};
