import {
	useAui,
	useAuiState,
	useExternalStoreRuntime,
	useRemoteThreadListRuntime,
} from "@assistant-ui/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { errorText } from "./api.js";
import { attachmentAdapter, deliveredOf, echoParts } from "./attachments.js";
import { refreshConversation, useConversation } from "./conversation.js";
import {
	hasRunningSubmission,
	isSettled,
	shownMessages,
	toThreadMessage,
} from "./convert.js";
import { createCreations } from "./creations.js";
import { finishedCalls, newDocumentWrites } from "./document-writes.js";
import { prepareTurn } from "./document.js";
import { threadListAdapter } from "./thread-list.js";

import type { FlueApi, SendContext, ThreadDoc } from "./api.js";
import type { Creations } from "./creations.js";
import type { OpenDocument } from "./document.js";
import type {
	AttachmentLimits,
	DeliveredAttachment,
} from "../protocol/attachments.js";
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
	/** The document the page edits, if its edit view is open. */
	document: () => OpenDocument | undefined;
	/** Calls `listener` when an edit view registers its document. */
	subscribeDocument: (listener: () => void) => () => void;
	/** The limits of chat attachments; null while they are off. */
	attachments: AttachmentLimits | null;
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
	attachments: DeliveredAttachment[];
	submissionId?: string;
}

// Marked optimistic, as it stands in for the message until the conversation carries it.
const echoOf = (pending: Pending): FlueConversationMessage => ({
	id: `pending:${pending.submissionId ?? "sending"}`,
	role: "user",
	purpose: "user",
	display: "visible",
	parts: [
		...(pending.text === ""
			? []
			: [{ type: "text", text: pending.text, state: "done" } as const]),
		...echoParts(pending.attachments),
	],
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
	const limits = session.current.attachments;
	const attachments = useMemo(
		() =>
			limits === null
				? undefined
				: attachmentAdapter(
						limits,
						() =>
							runtimeRef.current?.thread.composer.getState().attachments
								.length ?? 0,
					),
		[limits],
	);

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
		const { api, agent, context, document, refresh, onError } = session.current;
		const text = message.content
			.map((part) => (part.type === "text" ? part.text : ""))
			.join("")
			.trim();
		const files = deliveredOf(message.attachments ?? []);
		const item = aui.threadListItem.getState();
		const created =
			item.remoteId === undefined ? creations.start(item.id) : undefined;

		/*
		 * An empty message, or one without an agent to go to, creates no
		 * thread, so a thread list waiting for one is let go.
		 */
		if ((text === "" && files.length === 0) || agent === undefined) {
			created?.reject(new Error("The message cannot be sent."));

			return;
		}

		setPending({ text, attachments: files });

		try {
			await prepareTurn(document());

			const result = await api.chat(agent, {
				message: text,
				thread: item.remoteId,
				context: context(),
				// The key goes only with files, as the endpoint refuses it while attachments are off.
				...(files.length === 0 ? {} : { attachments: files }),
			});

			created?.resolve(result.thread.id);
			setPending({
				text,
				attachments: files,
				submissionId: result.submissionId,
			});

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
			const composer = runtimeRef.current?.thread.composer;

			composer?.setText(text);

			for (const attachment of message.attachments ?? []) {
				composer
					?.addAttachment({
						type: attachment.type,
						name: attachment.name,
						...(attachment.contentType === undefined
							? {}
							: { contentType: attachment.contentType }),
						content: [...attachment.content],
					})
					.catch(() => undefined);
			}

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
		...(attachments === undefined ? {} : { adapters: { attachments } }),
	});

	useEffect(() => {
		runtimeRef.current = runtime;
	}, [runtime]);

	/*
	 * Each write of the agent to the open document reloads its form. Calls of
	 * settled submissions are history when the conversation first loads.
	 */
	const handled = useRef<{ url: string; calls: Set<string> }>(undefined);
	// Counts documents registering, so writes waiting for one are delivered.
	const [registered, setRegistered] = useState(0);

	useEffect(
		() =>
			session.current.subscribeDocument(() => {
				setRegistered((count) => count + 1);
			}),
		[session],
	);

	useEffect(() => {
		if (url === undefined || conversation === undefined) {
			return;
		}

		if (handled.current?.url !== url) {
			handled.current = {
				url,
				calls: new Set(
					finishedCalls(
						conversation.messages.filter(
							(message) =>
								message.submissionId === undefined ||
								isSettled(conversation, message.submissionId),
						),
					),
				),
			};
		}

		const open = session.current.document();
		const writes = newDocumentWrites(
			conversation.messages,
			handled.current.calls,
			open,
		);

		if (open !== undefined && writes.length > 0) {
			for (const write of writes) {
				handled.current.calls.add(write);
			}

			open.reload(writes.length);
		}
	}, [url, conversation, session, registered]);

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
