"use client";

import {
	ActionBarPrimitive,
	AttachmentPrimitive,
	AuiIf,
	ComposerPrimitive,
	MessagePrimitive,
	ThreadListPrimitive,
	ThreadPrimitive,
	useAuiEvent,
	useAuiState,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import {
	CheckIcon,
	ChevronIcon,
	CopyIcon,
	PlusIcon,
	SpinnerIcon,
	toast,
	XIcon,
} from "@payloadcms/ui";
import React, { useEffect, useRef, useState } from "react";

import { useConversation } from "./conversation.js";
import { FileCard } from "./file-card.js";
import { PANEL_ID, PANEL_WIDTH, clampWidth } from "./layout.js";
import { useReadOnly } from "./runtime.js";
import { agentLabel, runMeta } from "./thread-row.js";
import { ThreadsView } from "./threads-view.js";
import { ConfirmableToolRow, DELETE_TOOL, ToolRow } from "./tools.js";
import { FILE_PART } from "../protocol/events.js";

import type { AgentSummary, FlueApi } from "./api.js";
import type { ConversationSnapshot } from "./conversation.js";
import type { RunningRow } from "./stale-running.js";
import type { ThreadCustom } from "./thread-list.js";
import type { AttachmentLimits } from "../protocol/attachments.js";
import type {
	Attachment,
	ReasoningMessagePartComponent,
	TextMessagePartComponent,
} from "@assistant-ui/react";
import type { MarkdownTextPrimitiveProps } from "@assistant-ui/react-markdown";

/** What the panel's body shows. */
export type PanelView = "conversation" | "threads";

// A keyboard resize moves the edge by this much.
const RESIZE_STEP = 16;

// The user's and the run outcome's text, shown as typed.
const Text: TextMessagePartComponent = ({ text }) => (
	<p className="flue-message__text">{text}</p>
);

/*
 * The agent writes Markdown, which can repeat text from the content it read.
 * Nothing in it loads by itself: images are dropped, raw HTML is skipped and
 * links open in a new tab without a referrer.
 */
const MARKDOWN_COMPONENTS: MarkdownTextPrimitiveProps["components"] = {
	a: ({ node: _node, ...props }) => (
		<a {...props} rel="noopener noreferrer nofollow" target="_blank" />
	),
};

const MARKDOWN_DISALLOWED = ["img"];

const Markdown: React.FC = () => (
	<MarkdownTextPrimitive
		className="flue-markdown"
		components={MARKDOWN_COMPONENTS}
		disallowedElements={MARKDOWN_DISALLOWED}
		skipHtml
	/>
);

const Reasoning: ReasoningMessagePartComponent = () => (
	<details className="flue-reasoning">
		<summary className="flue-disclosure">
			<span aria-hidden="true" className="flue-disclosure__chevron">
				<ChevronIcon direction="right" size={16} />
			</span>
			<span className="flue-disclosure__label">Reasoning</span>
		</summary>
		<div className="flue-reasoning__body">
			<Markdown />
		</div>
	</details>
);

const ASSISTANT_PARTS = {
	Text: Markdown,
	Reasoning,
	tools: { by_name: { [DELETE_TOOL]: ConfirmableToolRow }, Fallback: ToolRow },
	data: { by_name: { [FILE_PART]: FileCard } },
};

// An http(s) URL or a path on the admin's origin; a data URL is not linked.
const LINKABLE = /^(?:https?:\/\/|\/(?!\/))/i;

/*
 * A file of a user's message: an image as a thumbnail, anything else as a
 * link. The URL is the attachment route's, or a data URL while sending, when
 * only the name shows.
 */
const MessageAttachment: React.FC<{ attachment: Attachment }> = ({
	attachment,
}) => {
	const part = attachment.content?.[0];

	if (part?.type === "image") {
		return (
			<img
				alt={attachment.name}
				className="flue-attachment__image"
				src={part.image}
			/>
		);
	}

	if (part?.type !== "file") {
		return null;
	}

	return LINKABLE.test(part.data) ? (
		<a
			className="flue-attachment flue-attachment__link"
			href={part.data}
			rel="noopener noreferrer"
			target="_blank"
		>
			{attachment.name}
		</a>
	) : (
		<span className="flue-attachment">{attachment.name}</span>
	);
};

const UserMessage: React.FC = () => (
	<MessagePrimitive.Root className="flue-message flue-message--user">
		<div className="flue-message__attachments">
			<MessagePrimitive.Attachments>
				{({ attachment }) => <MessageAttachment attachment={attachment} />}
			</MessagePrimitive.Attachments>
		</div>
		<MessagePrimitive.Parts components={{ Text }} />
	</MessagePrimitive.Root>
);

// A file waiting in the composer, with its name and a remove button.
const ComposerAttachment: React.FC = () => (
	<AttachmentPrimitive.Root className="flue-attachment">
		<span className="flue-attachment__name">
			<AttachmentPrimitive.Name />
		</span>
		<AttachmentPrimitive.Remove
			aria-label="Remove file"
			className="flue-icon-button flue-attachment__remove"
		>
			<XIcon size={16} />
		</AttachmentPrimitive.Remove>
	</AttachmentPrimitive.Root>
);

const AssistantMessage: React.FC = () => (
	<MessagePrimitive.Root className="flue-message flue-message--assistant">
		<MessagePrimitive.Parts components={ASSISTANT_PARTS} />
		{/* Floats on hover over earlier messages, so nothing below moves. */}
		<ActionBarPrimitive.Root
			autohide="not-last"
			autohideFloat="always"
			className="flue-message__actions"
			hideWhenRunning
		>
			<ActionBarPrimitive.Copy
				aria-label="Copy"
				className="flue-icon-button flue-message__action"
			>
				<span className="flue-message__copy">
					<CopyIcon size={24} />
				</span>
				<span className="flue-message__copied">
					<CheckIcon size={24} />
				</span>
			</ActionBarPrimitive.Copy>
		</ActionBarPrimitive.Root>
	</MessagePrimitive.Root>
);

// A failed or stopped run.
const SystemMessage: React.FC = () => (
	<MessagePrimitive.Root className="flue-message flue-message--system">
		<MessagePrimitive.Parts components={{ Text }} />
	</MessagePrimitive.Root>
);

const MESSAGES = {
	user: UserMessage,
	assistant: AssistantMessage,
	system: SystemMessage,
};

/** The hint for a thread whose conversation Flue no longer has. */
export const LOST_CONVERSATION =
	"The agent no longer has this conversation. Start a new thread.";

/**
 * The conversation view's title bar: the thread's title, for a run its
 * agent and how it started, and the hint for a lost conversation.
 */
export const ConversationTitle: React.FC<{
	title?: string | undefined;
	meta?: string | undefined;
	lost: boolean;
}> = ({ title, meta, lost }) => (
	<div className="flue-title">
		<div className="flue-title__line">
			<h2 className="flue-title__text">{title ?? "New thread"}</h2>
			{meta === undefined ? null : (
				<span className="flue-title__meta">{meta}</span>
			)}
		</div>
		{lost ? <p className="flue-title__hint">{LOST_CONVERSATION}</p> : null}
	</div>
);

/**
 * Whether Flue lost the open thread's conversation: its row failed and the
 * conversation is absent. Absent alone also describes a thread before its
 * first message.
 */
export const lostConversation = (
	custom: Partial<ThreadCustom> | undefined,
	phase: ConversationSnapshot["phase"],
): boolean => custom?.failed === true && phase === "absent";

const TitleBar: React.FC<{ api: FlueApi; agents: AgentSummary[] }> = ({
	api,
	agents,
}) => {
	const remoteId = useAuiState((state) => state.threadListItem.remoteId);
	const title = useAuiState((state) => state.threadListItem.title);
	const custom = useAuiState((state) => state.threadListItem.custom) as
		Partial<ThreadCustom> | undefined;
	const { phase } = useConversation(
		remoteId === undefined ? undefined : api.conversationUrl(remoteId),
	);

	return (
		<ConversationTitle
			lost={lostConversation(custom, phase)}
			meta={
				custom?.agent === undefined
					? undefined
					: runMeta(agentLabel(agents, custom.agent), custom.kind)
			}
			title={title}
		/>
	);
};

// Without an agent, in Runs-only mode, the panel only reads runs.
const EmptyThread: React.FC<{ agent: AgentSummary | undefined }> = ({
	agent,
}) => (
	<div className="flue-thread__empty">
		{agent === undefined ? (
			<p>Open a run from Threads to read it.</p>
		) : (
			<>
				<p className="flue-thread__empty-title">{agent.label ?? agent.slug}</p>
				{agent.description === undefined ? null : <p>{agent.description}</p>}
				<p>Ask the agent about this page or your content.</p>
			</>
		)}
	</div>
);

export interface FluePanelProps {
	open: boolean;
	onClose: () => void;
	api: FlueApi;
	agents: AgentSummary[];
	/** The agent the user chats with; none in Runs-only mode. */
	agent: string | undefined;
	/** Every agent, when the user may read agent runs. */
	runAgents?: AgentSummary[] | undefined;
	/** The limits of chat attachments; null or unset while they are off. */
	attachments?: AttachmentLimits | null | undefined;
	/** Switches the agent, which opens a new thread. */
	onAgent: (slug: string) => void;
	/** Opens a chat of any agent, switching the agent when it differs. */
	onOpenThread: (agent: string, threadId: string) => void;
	/** Opens a run of any agent, read-only, without switching the agent. */
	onOpenRun: (threadId: string) => void;
	view: PanelView;
	onView: (view: PanelView) => void;
	/** The error of the thread list's last failed next page. */
	loadMoreError: unknown;
	/** Reads the listed rows a settlement may have missed again. */
	onStale: (rows: readonly RunningRow[]) => void;
	width: number;
	/** Called while the edge is dragged. */
	onResize: (width: number) => void;
	/** Called once a resize ends, with the width to keep. */
	onResizeEnd: (width: number) => void;
}

/**
 * The chat panel: agent picker, and either the open thread with its
 * composer or the Threads view, from assistant-ui's primitives. Hidden, not
 * unmounted, while closed or in the other view, so a draft survives.
 */
export const FluePanel: React.FC<FluePanelProps> = ({
	open,
	onClose,
	api,
	agents,
	agent,
	runAgents,
	attachments,
	onAgent,
	onOpenThread,
	onOpenRun,
	view,
	onView,
	loadMoreError,
	onStale,
	width,
	onResize,
	onResizeEnd,
}) => {
	const readOnly = useReadOnly();
	const drag = useRef<{ x: number; width: number } | null>(null);
	const [resizing, setResizing] = useState(false);
	const composer = useRef<HTMLTextAreaElement>(null);
	// Set when returning to the conversation should focus the composer.
	const focusComposer = useRef(false);

	// A file the composer refused, by type, size or count.
	useAuiEvent("composer.attachmentAddError", ({ message }) => {
		toast.error(message);
	});

	const showConversation = (focus: boolean): void => {
		focusComposer.current = focus;
		onView("conversation");
	};

	useEffect(() => {
		if (view === "conversation" && focusComposer.current) {
			focusComposer.current = false;
			composer.current?.focus();
		}
	}, [view]);

	const dragged = (clientX: number): number =>
		drag.current === null
			? width
			: clampWidth(drag.current.width + drag.current.x - clientX);

	// The width on screen, below the kept one while the admin needs the room.
	const shown = (handle: HTMLElement): number =>
		Math.round(handle.parentElement?.getBoundingClientRect().width ?? width);

	return (
		<aside
			aria-label="Agent chat"
			className="flue-panel"
			data-resizing={resizing ? "" : undefined}
			hidden={!open}
			id={PANEL_ID}
		>
			<div
				aria-label="Resize the agent chat"
				aria-orientation="vertical"
				aria-valuemax={PANEL_WIDTH.max}
				aria-valuemin={PANEL_WIDTH.min}
				aria-valuenow={width}
				className="flue-panel__resize"
				onKeyDown={(event) => {
					const step =
						event.key === "ArrowLeft"
							? RESIZE_STEP
							: event.key === "ArrowRight"
								? -RESIZE_STEP
								: 0;

					if (step !== 0) {
						event.preventDefault();
						onResizeEnd(clampWidth(shown(event.currentTarget) + step));
					}
				}}
				onPointerDown={(event) => {
					event.preventDefault();
					event.currentTarget.setPointerCapture(event.pointerId);
					drag.current = {
						x: event.clientX,
						width: shown(event.currentTarget),
					};
					setResizing(true);
				}}
				onPointerMove={(event) => {
					if (drag.current !== null) {
						onResize(dragged(event.clientX));
					}
				}}
				onPointerUp={(event) => {
					if (drag.current !== null) {
						onResizeEnd(dragged(event.clientX));
						drag.current = null;
						setResizing(false);
					}
				}}
				role="separator"
				tabIndex={0}
			/>
			<header className="flue-panel__header">
				{agent === undefined ? null : (
					<span className="flue-panel__agent">
						<select
							aria-label="Agent"
							className="flue-panel__agent-select"
							onChange={(event) => {
								onAgent(event.target.value);
							}}
							value={agent}
						>
							{agents.map((entry) => (
								<option
									key={entry.slug}
									title={entry.description}
									value={entry.slug}
								>
									{entry.label ?? entry.slug}
								</option>
							))}
						</select>
						<span aria-hidden="true" className="flue-panel__agent-chevron">
							<ChevronIcon size={16} />
						</span>
					</span>
				)}
				<button
					aria-pressed={view === "threads"}
					className="flue-button flue-button--pill flue-panel__view"
					onClick={() => {
						if (view === "threads") {
							showConversation(false);
						} else {
							onView("threads");
						}
					}}
					type="button"
				>
					Threads
				</button>
				{agent === undefined ? null : (
					<ThreadListPrimitive.New
						className="flue-button flue-button--pill flue-button--icon"
						onClick={() => {
							showConversation(true);
						}}
					>
						<PlusIcon size={16} />
						New thread
					</ThreadListPrimitive.New>
				)}
				<button
					aria-label="Close"
					className="flue-icon-button"
					onClick={onClose}
					type="button"
				>
					<XIcon size={24} />
				</button>
			</header>
			<ThreadsView
				agent={agent}
				agents={agents}
				api={api}
				hidden={!open || view !== "threads"}
				runAgents={runAgents}
				loadMoreError={loadMoreError}
				onBack={() => {
					showConversation(true);
				}}
				onOpen={onOpenThread}
				onOpenRun={onOpenRun}
				onOpened={() => {
					showConversation(true);
				}}
				onStale={onStale}
			/>
			<div className="flue-conversation" hidden={view !== "conversation"}>
				<TitleBar agents={runAgents ?? agents} api={api} />
				<ThreadPrimitive.Root className="flue-thread">
					<ThreadPrimitive.Viewport className="flue-thread__viewport">
						<AuiIf condition={(state) => state.thread.isEmpty}>
							<EmptyThread
								agent={agents.find((entry) => entry.slug === agent)}
							/>
						</AuiIf>
						<ThreadPrimitive.Messages>
							{({ message }) => {
								const Message = MESSAGES[message.role];

								return <Message />;
							}}
						</ThreadPrimitive.Messages>
						<AuiIf condition={(state) => state.thread.isRunning}>
							<p className="flue-thread__working" role="status">
								<SpinnerIcon size="sm" />
								The agent is working.
							</p>
						</AuiIf>
					</ThreadPrimitive.Viewport>
					{agent === undefined ? null : (
						<ComposerPrimitive.Root className="flue-composer">
							{attachments ? (
								<div className="flue-composer__attachments">
									<ComposerPrimitive.Attachments>
										{() => <ComposerAttachment />}
									</ComposerPrimitive.Attachments>
								</div>
							) : null}
							<ComposerPrimitive.Input
								aria-label="Message"
								className="flue-composer__input"
								ref={composer}
								maxRows={10}
								minRows={2}
								placeholder={
									readOnly
										? "This thread belongs to an agent run and is read-only."
										: "Message the agent"
								}
								submitMode="enter"
							/>
							<div className="flue-composer__actions">
								{attachments ? (
									<ComposerPrimitive.AddAttachment className="flue-button flue-composer__attach">
										Attach
									</ComposerPrimitive.AddAttachment>
								) : null}
								<AuiIf
									condition={(state) =>
										state.thread.isRunning && !state.thread.isDisabled
									}
								>
									<ComposerPrimitive.Cancel className="flue-button">
										Stop
									</ComposerPrimitive.Cancel>
								</AuiIf>
								<ComposerPrimitive.Send className="flue-button flue-button--primary">
									Send
								</ComposerPrimitive.Send>
							</div>
						</ComposerPrimitive.Root>
					)}
				</ThreadPrimitive.Root>
			</div>
		</aside>
	);
};
