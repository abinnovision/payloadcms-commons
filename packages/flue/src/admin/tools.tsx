"use client";

import { useAui, useAuiState } from "@assistant-ui/react";
import { ChevronIcon, PayloadLink, SpinnerIcon } from "@payloadcms/ui";
import React, {
	createContext,
	useContext,
	useEffect,
	useId,
	useState,
} from "react";

import { errorText } from "./api.js";
import { confirmationOf } from "./confirmation.js";
import { useReadOnly } from "./runtime.js";

import type { ConfirmationDecision, FlueApi } from "./api.js";
import type { PendingConfirmation } from "./confirmation.js";
import type { ToolCallMessagePartComponent } from "@assistant-ui/react";

/** The confirmable mcpx tool whose output asks for the user's approval. */
export const DELETE_TOOL = "mcp__payload__deleteDocument";

/** The turns sent after a decision, so the agent runs or drops the call. */
const FOLLOW_UP: Record<ConfirmationDecision, string> = {
	approved: "Approved. Run the confirmed call.",
	rejected: "Rejected.",
};

/** What the tool renderers need beyond their part. */
export interface ToolsContextValue {
	api: FlueApi;
	adminRoute: string;
	/** The admin's origin, which resolves a relative confirmation URL. */
	origin: string;
}

export const ToolsContext = createContext<ToolsContextValue | null>(null);

const useTools = (): ToolsContextValue => {
	const tools = useContext(ToolsContext);

	if (tools === null) {
		throw new Error("The tool renderers need a ToolsContext.");
	}

	return tools;
};

// An MCP result often arrives as JSON text, which reads better indented.
const parsed = (value: string): unknown => {
	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
};

const format = (value: unknown): string => {
	const shown = typeof value === "string" ? parsed(value) : value;

	return typeof shown === "string" ? shown : JSON.stringify(shown, null, 2);
};

// The agent reaches Payload through one MCP server, so its prefix says nothing.
const shortName = (toolName: string): string =>
	toolName.replace(/^mcp__payload__/, "");

/**
 * One tool call: its name and status, expanding to input and output.
 */
export const ToolRow: ToolCallMessagePartComponent = ({
	toolName,
	args,
	result,
	isError,
	status,
}) => {
	const [expanded, setExpanded] = useState(false);
	const detailsId = useId();
	const state =
		result === undefined
			? status.type === "running"
				? "Running"
				: "No result"
			: isError === true
				? "Failed"
				: "Done";

	return (
		<div className="flue-tool" data-state={state.toLowerCase()}>
			<button
				aria-controls={detailsId}
				aria-expanded={expanded}
				className="flue-disclosure flue-tool__header"
				onClick={() => {
					setExpanded((current) => !current);
				}}
				title={toolName}
				type="button"
			>
				<span aria-hidden="true" className="flue-disclosure__chevron">
					<ChevronIcon direction="right" size={16} />
				</span>
				<span className="flue-disclosure__label flue-tool__name">
					{shortName(toolName)}
				</span>
				<span className="flue-tool__status">
					{state === "Running" ? <SpinnerIcon size="sm" /> : null}
					{state}
				</span>
			</button>
			{expanded ? (
				<div className="flue-tool__details" id={detailsId}>
					<p className="flue-tool__label">Input</p>
					<pre className="flue-tool__code">{format(args)}</pre>
					{result === undefined ? null : (
						<>
							<p className="flue-tool__label">
								{isError === true ? "Error" : "Output"}
							</p>
							<pre className="flue-tool__code">{format(result)}</pre>
						</>
					)}
				</div>
			) : null}
		</div>
	);
};

type ApprovalState =
	| ConfirmationDecision
	| "closed"
	| "deciding"
	| "loading"
	| "pending"
	| "readOnly";

const STATE_TEXT: Record<ApprovalState, string> = {
	loading: "Checking the approval.",
	pending: "Waiting for approval.",
	deciding: "Saving the decision.",
	approved: "Approved.",
	rejected: "Rejected.",
	closed: "This call no longer waits for approval.",
	readOnly: "This call asked for approval in the admin.",
};

const Approval: React.FC<{ confirmation: PendingConfirmation }> = ({
	confirmation,
}) => {
	const { api } = useTools();
	const aui = useAui();
	const running = useAuiState((state) => state.thread.isRunning);
	const readOnly = useReadOnly();
	const [state, setState] = useState<ApprovalState>(
		readOnly ? "readOnly" : "loading",
	);
	const [handle, setHandle] = useState<string>();
	const [error, setError] = useState<string>();
	const { id, key, review } = confirmation;

	/*
	 * Only the key's user may read the call, so a thread of an agent run
	 * shows the review link alone and asks nothing.
	 */
	useEffect(() => {
		if (readOnly) {
			return;
		}

		let active = true;

		api
			.confirmationHandle(key, id)
			.then((found) => {
				if (active) {
					setHandle(found);
					setState(found === undefined ? "closed" : "pending");
				}
			})
			.catch(() => {
				if (active) {
					setState("closed");
				}
			});

		return () => {
			active = false;
		};
	}, [api, key, id, readOnly]);

	const decide = (decision: ConfirmationDecision): void => {
		if (handle === undefined) {
			return;
		}

		setState("deciding");
		setError(undefined);
		api
			.decide(key, handle, decision)
			.then((recorded) => {
				setState(recorded ? decision : "closed");

				if (recorded) {
					aui.thread.append(FOLLOW_UP[decision]);
				}
			})
			.catch((decideError: unknown) => {
				setState("pending");
				setError(errorText(decideError, "The decision could not be saved."));
			});
	};

	return (
		<div className="flue-approval" data-state={state}>
			<p className="flue-approval__status" role="status">
				{STATE_TEXT[state]}
			</p>
			{error === undefined ? null : (
				<p className="flue-approval__error" role="alert">
					{error}
				</p>
			)}
			<div className="flue-approval__footer">
				{state === "pending" ? (
					<div className="flue-approval__actions">
						<button
							className="flue-button flue-button--primary"
							disabled={running}
							onClick={() => {
								decide("approved");
							}}
							type="button"
						>
							Approve
						</button>
						<button
							className="flue-button"
							disabled={running}
							onClick={() => {
								decide("rejected");
							}}
							type="button"
						>
							Reject
						</button>
					</div>
				) : null}
				<PayloadLink className="flue-approval__review" href={review}>
					Review in admin
				</PayloadLink>
			</div>
		</div>
	);
};

/**
 * A confirmable call. When its output asks for approval, Approve and Reject
 * decide it through mcpx and send the turn that lets the agent go on.
 */
export const ConfirmableToolRow: ToolCallMessagePartComponent = (props) => {
	const { adminRoute, origin } = useTools();
	const confirmation =
		props.isError === true
			? undefined
			: confirmationOf(props.result, origin, adminRoute);

	return (
		<>
			<ToolRow {...props} />
			{confirmation === undefined ? null : (
				<Approval confirmation={confirmation} />
			)}
		</>
	);
};
