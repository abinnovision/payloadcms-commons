import type { ThreadId } from "./api.js";

/** A new thread's first message on its way, which settles the creation. */
export interface Creation {
	resolve: (id: ThreadId) => void;
	/** Fails the wait and forgets the creation, so the next message starts another. */
	reject: (reason: unknown) => void;
}

/**
 * New threads by the thread list's local id. The first message creates the
 * thread through the chat endpoint while the thread list waits for its id;
 * either side may come first.
 */
export const createCreations = () => {
	const entries = new Map<string, PromiseWithResolvers<ThreadId>>();

	const entryFor = (localId: string): PromiseWithResolvers<ThreadId> => {
		let entry = entries.get(localId);

		if (entry === undefined) {
			entry = Promise.withResolvers<ThreadId>();
			// A failed send rejects it whether or not the thread list waits.
			entry.promise.catch(() => undefined);
			entries.set(localId, entry);
		}

		return entry;
	};

	const forget = (
		localId: string,
		entry: PromiseWithResolvers<ThreadId>,
	): void => {
		if (entries.get(localId) === entry) {
			entries.delete(localId);
		}
	};

	return {
		/** Starts the creation of the thread, or joins the wait for it. */
		start: (localId: string): Creation => {
			const entry = entryFor(localId);

			return {
				resolve: entry.resolve,
				reject: (reason) => {
					entry.reject(reason);
					forget(localId, entry);
				},
			};
		},

		/** The id of the thread once its first message created it. */
		wait: async (localId: string): Promise<ThreadId> => {
			const entry = entryFor(localId);

			try {
				return await entry.promise;
			} finally {
				forget(localId, entry);
			}
		},
	};
};

export type Creations = ReturnType<typeof createCreations>;
