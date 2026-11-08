import { createFlueClient } from "@flue/sdk";
import { useCallback, useSyncExternalStore } from "react";

import type {
	AgentConversationObservation,
	AgentConversationObservationSnapshot,
} from "@flue/sdk";

export type ConversationSnapshot = AgentConversationObservationSnapshot;

interface Observed {
	observation: AgentConversationObservation;
	subscribers: number;
}

/*
 * One observation per conversation URL, shared by every subscriber. It is
 * created by the first subscription and closed with the last, so a thread
 * that is deselected or unmounted stops following its conversation.
 */
const observed = new Map<string, Observed>();

const LOADING: ConversationSnapshot = {
	conversation: undefined,
	offset: undefined,
	phase: "loading",
	error: undefined,
};

// A thread without a conversation yet, before its first message.
const NONE: ConversationSnapshot = { ...LOADING, phase: "absent" };

// Session cookies also reach a server URL on another origin.
const credentialed: typeof fetch = (input, init) =>
	fetch(input, { ...init, credentials: "include" });

const acquire = (url: string): Observed => {
	let entry = observed.get(url);

	if (entry === undefined) {
		entry = {
			observation: createFlueClient({ url, fetch: credentialed }).observe({
				live: "long-poll",
			}),
			subscribers: 0,
		};
		observed.set(url, entry);
	}

	entry.subscribers += 1;

	return entry;
};

const release = (url: string, entry: Observed): void => {
	entry.subscribers -= 1;

	if (entry.subscribers === 0 && observed.get(url) === entry) {
		observed.delete(url);
		entry.observation.close();
	}
};

/**
 * Calls `listener` on each change of the conversation at `url`. Returns the
 * unsubscribe; the last one closes the URL's observation.
 */
export const subscribeConversation = (
	url: string,
	listener: () => void,
): (() => void) => {
	const entry = acquire(url);
	const unsubscribe = entry.observation.subscribe(listener);

	return () => {
		unsubscribe();
		release(url, entry);
	};
};

/** The conversation at `url` as last observed, loading while nobody follows it. */
export const conversationSnapshot = (url: string): ConversationSnapshot =>
	observed.get(url)?.observation.getSnapshot() ?? LOADING;

/**
 * Reads the conversation again and resumes following it, for a conversation
 * that was absent when its observation started.
 */
export const refreshConversation = (url: string): void => {
	observed.get(url)?.observation.refresh();
};

/**
 * The live conversation at `url`, hydrated from its history and followed by
 * long-polling. Without a URL there is no conversation yet.
 */
export const useConversation = (
	url: string | undefined,
): ConversationSnapshot => {
	const subscribe = useCallback(
		(listener: () => void) =>
			url === undefined
				? () => undefined
				: subscribeConversation(url, listener),
		[url],
	);
	const getSnapshot = useCallback(
		() => (url === undefined ? NONE : conversationSnapshot(url)),
		[url],
	);
	const getServerSnapshot = useCallback(
		() => (url === undefined ? NONE : LOADING),
		[url],
	);

	return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
};
