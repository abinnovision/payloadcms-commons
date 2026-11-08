import {
	useAui,
	useAuiState,
	useExternalStoreRuntime,
	useRemoteThreadListRuntime,
} from "@assistant-ui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { errorText } from "./api.js";
import { refreshConversation, useConversation } from "./conversation.js";
import {
	hasRunningSubmission,
	isSettled,
	shownMessages,
	toThreadMessage,
} from "./convert.js";
import { createCreations } from "./creations.js";
import { threadListAdapter } from "./thread-list.js";

import type { FlueApi, SendContext, ThreadDoc } from "./api.js";
import type { Creations } from "./creations.js";
import type { AppendMessage, AssistantRuntime } from "@assistant-ui/react";
import type { FlueConversationMessage } from "@flue/sdk";
import type { RefObject } from "react";

/** What a thread's runtime reads from the panel when it acts. */
export interface ChatSession {
	api: FlueApi;
	/** The agent messages go to; none in Runs-only mode, which has no composer. */
	agent: string | undefined;
	/** The admin page a message is sent from. */
	context: () => SendContext;
	/** Lists the threads again, after a send and once a run settles. */
	refresh: () => void;
	onError: (message: string) => void;
}

/** Whether the user may read the thread in scope but did not start it. */
export const useReadOnly = (): boolean =>
	useAuiState((state) => state.threadListItem.custom?.["readOnly"] === true);

// A message on its way, shown until the conversation carries it.
interface Pending {
	text: string;
	submissionId?: string;
}

// Marked optimistic, as it stands in for the message until the conversation carries it.
const echoOf = (pending: Pending): FlueConversationMessage => ({
	id: `pending:${pending.submissionId ?? "sending"}`,
	role: "user",
	purpose: "user",
	display: "visible",
	parts: [{ type: "text", text: pending.text, state: "done" }],
	metadata: { isOptimistic: true },
});

/*
 * One thread's runtime, fed by the SDK's observation of its conversation.
 * Messages go through the chat endpoint, never through the SDK.
 */
const useThreadRuntime = (
	session: RefObject<ChatSession>,
	creations: Creations,
): AssistantRuntime => {
	const aui = useAui();
	const remoteId = useAuiState((state) => state.threadListItem.remoteId);
	const readOnly = useReadOnly();
	const url =
		remoteId === undefined
			? undefined
			: session.current.api.conversationUrl(remoteId);
	const { conversation, phase, error } = useConversation(url);
	const [pending, setPending] = useState<Pending>();
	const runtimeRef = useRef<AssistantRuntime>(null);

	const delivered =
		pending?.submissionId !== undefined &&
		(isSettled(conversation, pending.submissionId) ||
			conversation?.messages.some(
				(message) => message.submissionId === pending.submissionId,
			) === true);
	const echo = useMemo(
		() => (pending === undefined ? undefined : echoOf(pending)),
		[pending],
	);
	const messages = useMemo(() => {
		const shown = shownMessages(conversation);

		return echo === undefined || delivered ? shown : [...shown, echo];
	}, [conversation, echo, delivered]);
	const running =
		hasRunningSubmission(conversation) ||
		(pending !== undefined &&
			(pending.submissionId === undefined ||
				!isSettled(conversation, pending.submissionId)));

	const onNew = async (message: AppendMessage): Promise<void> => {
		const { api, agent, context, refresh, onError } = session.current;
		const text = message.content
			.map((part) => (part.type === "text" ? part.text : ""))
			.join("")
			.trim();
		const item = aui.threadListItem.getState();
		const created =
			item.remoteId === undefined ? creations.start(item.id) : undefined;

		/*
		 * An empty message, or one without an agent to go to, creates no
		 * thread, so a thread list waiting for one is let go.
		 */
		if (text === "" || agent === undefined) {
			created?.reject(new Error("The message cannot be sent."));

			return;
		}

		setPending({ text });

		try {
			const result = await api.chat(agent, {
				message: text,
				thread: item.remoteId,
				context: context(),
			});

			created?.resolve(result.thread.id);
			setPending({ text, submissionId: result.submissionId });

			// An observation that stopped does not see the new message by itself.
			if (
				item.remoteId !== undefined &&
				(phase === "absent" || phase === "error")
			) {
				refreshConversation(api.conversationUrl(item.remoteId));
			}
		} catch (sendError) {
			created?.reject(sendError);
			setPending(undefined);
			runtimeRef.current?.thread.composer.setText(text);
			onError(errorText(sendError, "The message could not be sent."));
		} finally {
			refresh();
		}
	};

	const onCancel = async (): Promise<void> => {
		if (remoteId === undefined) {
			return;
		}

		try {
			await session.current.api.abort(remoteId);
		} catch (abortError) {
			session.current.onError(
				errorText(abortError, "The run could not be stopped."),
			);
		}
	};

	const runtime = useExternalStoreRuntime<FlueConversationMessage>({
		messages,
		convertMessage: toThreadMessage,
		isRunning: running,
		isLoading: phase === "loading",
		isDisabled: readOnly,
		onNew,
		onCancel,
	});

	useEffect(() => {
		runtimeRef.current = runtime;
	}, [runtime]);

	// A settled run may have changed the thread's title and status.
	const wasRunning = useRef(running);

	useEffect(() => {
		if (wasRunning.current && !running) {
			session.current.refresh();
		}

		wasRunning.current = running;
	}, [running, session]);

	useEffect(() => {
		if (phase === "error") {
			session.current.onError(
				errorText(error, "The conversation could not be loaded."),
			);
		}
	}, [phase, error, session]);

	return runtime;
};

export interface FlueRuntimeOptions {
	session: RefObject<ChatSession>;
	api: FlueApi;
	agent: string | undefined;
	isOwn: (thread: ThreadDoc) => boolean;
	onList: (threads: ThreadDoc[]) => void;
	onLoadMoreError: (error: unknown) => void;
	/** The open thread; undefined opens a new one. */
	threadId: string | undefined;
	/** Called when the user opens another thread or a new one gets its id. */
	onThreadIdChange: (threadId: string | undefined) => void;
}

/**
 * The agent's threads as an assistant-ui runtime: the list from the threads
 * collection, the open thread from its Flue conversation.
 */
export const useFlueRuntime = ({
	session,
	api,
	agent,
	isOwn,
	onList,
	onLoadMoreError,
	threadId,
	onThreadIdChange,
}: FlueRuntimeOptions): AssistantRuntime => {
	const creations = useMemo(createCreations, []);
	const adapter = useMemo(
		() =>
			threadListAdapter({
				api,
				agent,
				isOwn,
				onList,
				onLoadMoreError,
				created: creations.wait,
			}),
		[api, agent, isOwn, onList, onLoadMoreError, creations],
	);
	const runtimeHook = useCallback(
		function useFlueThread() {
			return useThreadRuntime(session, creations);
		},
		[session, creations],
	);

	return useRemoteThreadListRuntime({
		runtimeHook,
		adapter,
		threadId,
		onThreadIdChange,
	});
};
