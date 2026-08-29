import { AsyncLocalStorage } from "node:async_hooks";

/** The one write the draft guard is allowed to let through as a publish. */
export interface PublishIntent {
	kind: "collection" | "global";
	slug: string;
	/** Absent for a global, which is a singleton. */
	id?: number | string | undefined;
}

interface ActiveIntent extends PublishIntent {
	/** Set once one operation has claimed the intent. */
	claimed: boolean;
}

/*
 * `AsyncLocalStorage` rather than `req.context` or a WeakMap keyed on `req`.
 * The endpoint builds one PayloadRequest per HTTP request and hands the same
 * object to every tool, and the MCP transport dispatches the messages of a
 * JSON-RPC batch concurrently. A flag on the request would therefore be visible
 * to a sibling patchDocument call on the same document, which is exactly the
 * write it must not turn into a publish. Every hook Payload runs during the
 * update, fan-out included, is inside the promise chain this store opens, while
 * a sibling call is in another async context and sees nothing.
 *
 * Not a security boundary: a custom tool holds the whole payload instance and
 * needs no help from here. It keeps the guard from being widened by accident.
 */
const store = new AsyncLocalStorage<ActiveIntent>();

/** Runs `fn` with `intent` in force. */
export const withPublishIntent = async <T>(
	intent: PublishIntent,
	fn: () => Promise<T>,
): Promise<T> => await store.run({ ...intent, claimed: false }, fn);

const activeFor = (target: PublishIntent): ActiveIntent | undefined => {
	const active = store.getStore();

	return active &&
		active.kind === target.kind &&
		active.slug === target.slug &&
		active.id === target.id
		? active
		: undefined;
};

/**
 * Claims the intent for one operation, which `beforeOperation` does so that a
 * re-entrant write to the same document — an `afterChange` hook calling
 * `payload.update`, say — cannot ride along on it. Only the first operation to
 * ask gets it.
 */
export const claimPublishIntent = (target: PublishIntent): boolean => {
	const active = activeFor(target);

	if (!active || active.claimed) {
		return false;
	}

	active.claimed = true;

	return true;
};

/**
 * Whether this change belongs to the operation that claimed the intent, which
 * is what lets the `beforeChange` alarm accept a published status.
 *
 * The id is deliberately not compared here. A `beforeChange` hook reads it from
 * the loaded document, where Payload has already coerced it to the collection's
 * id type, while the claim above saw the raw tool argument; comparing the two
 * would refuse a legitimate publish over `1` versus `"1"`. Nothing is lost: a
 * nested write to another document of the same collection during the publish
 * cannot claim the intent, so `forceDraftWrite` has already stripped its
 * `_status` and it fails the alarm on that.
 */
export const isClaimedPublish = (
	kind: PublishIntent["kind"],
	slug: string,
): boolean => {
	const active = store.getStore();

	return active?.kind === kind && active.slug === slug && active.claimed;
};
