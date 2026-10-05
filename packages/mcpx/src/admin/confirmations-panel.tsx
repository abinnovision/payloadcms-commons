"use client";

import { Button } from "@payloadcms/ui";
import React from "react";

import type {
	ConfirmationDecision,
	ConfirmationView,
} from "../api-keys/confirmation-view.js";

export interface ConfirmationsPanelProps {
	confirmations: ConfirmationView[];
	/**
	 * A decision is being saved, so no other may start.
	 */
	busy: boolean;
	onDecide: (handles: string[], decision: ConfirmationDecision) => void;
}

/**
 * The element id of a call's row, which the page scrolls to.
 */
export const confirmationRowId = (handle: string): string =>
	`mcpx-confirmation-${handle}`;

const CELL_PADDING = "calc(var(--base) * 0.4) calc(var(--base) * 0.6)";

/*
 * Payload's theme variables, so the panel follows the admin's light and dark
 * themes without a stylesheet that consumers would have to transpile.
 */
const styles = {
	panel: {
		marginBottom: "var(--base)",
		padding: "calc(var(--base) * 0.75)",
		border: "1px solid var(--theme-elevation-150)",
		borderRadius: "3px",
		background: "var(--theme-elevation-50)",
	},
	heading: { margin: 0 },
	lead: {
		margin: "calc(var(--base) * 0.25) 0 calc(var(--base) * 0.75)",
		color: "var(--theme-elevation-500)",
	},
	group: { marginBottom: "calc(var(--base) * 0.75)" },
	groupHeading: { margin: "0 0 calc(var(--base) * 0.25)" },
	table: { width: "100%", borderCollapse: "collapse", textAlign: "left" },
	head: {
		padding: CELL_PADDING,
		color: "var(--theme-elevation-400)",
		fontWeight: "normal",
		borderBottom: "1px solid var(--theme-border-color)",
	},
	cell: {
		padding: CELL_PADDING,
		verticalAlign: "middle",
		borderBottom: "1px solid var(--theme-elevation-100)",
	},
	highlighted: { background: "var(--theme-elevation-100)" },
	muted: { color: "var(--theme-elevation-500)" },
	status: {
		display: "block",
		color: "var(--theme-elevation-500)",
		fontSize: "0.85em",
	},
	permanent: { color: "var(--theme-error-500)", fontWeight: 600 },
	actions: {
		display: "flex",
		gap: "calc(var(--base) * 0.25)",
		justifyContent: "flex-end",
	},
	footer: { display: "flex", gap: "calc(var(--base) * 0.5)" },
} as const satisfies Record<string, React.CSSProperties>;

const HEADS = ["Collection", "Document", "Effect", "Reason"];

const groupsOf = (
	confirmations: ConfirmationView[],
): [string, ConfirmationView[]][] => {
	const groups = new Map<string, ConfirmationView[]>();

	for (const confirmation of confirmations) {
		const entries = groups.get(confirmation.group) ?? [];

		entries.push(confirmation);
		groups.set(confirmation.group, entries);
	}

	return [...groups];
};

const DecisionButtons: React.FC<{
	approve: React.ReactNode;
	busy: boolean;
	onDecide: (decision: ConfirmationDecision) => void;
	reject: React.ReactNode;
	small?: boolean;
}> = ({ approve, busy, onDecide, reject, small = false }) => (
	<>
		<Button
			buttonStyle="primary"
			disabled={busy}
			margin={false}
			onClick={() => {
				onDecide("approved");
			}}
			size={small ? "small" : "medium"}
			type="button"
		>
			{approve}
		</Button>
		<Button
			buttonStyle="secondary"
			disabled={busy}
			margin={false}
			onClick={() => {
				onDecide("rejected");
			}}
			size={small ? "small" : "medium"}
			type="button"
		>
			{reject}
		</Button>
	</>
);

// The irreversible ones are counted apart, so the bulk approval names them.
const approveAllLabel = (confirmations: ConfirmationView[]): string => {
	const permanent = confirmations.filter(
		(confirmation) => confirmation.summary.permanent,
	).length;

	return permanent === 0
		? `Approve all (${String(confirmations.length)})`
		: `Approve all (${String(confirmations.length)}, ${String(permanent)} permanent)`;
};

const Row: React.FC<{
	busy: boolean;
	confirmation: ConfirmationView;
	onDecide: ConfirmationsPanelProps["onDecide"];
}> = ({ busy, confirmation, onDecide }) => {
	const { handle, highlighted, summary } = confirmation;
	const cell = highlighted
		? { ...styles.cell, ...styles.highlighted }
		: styles.cell;
	const name = summary.title ?? summary.id ?? "Unreadable";

	return (
		<tr
			aria-current={highlighted ? "true" : undefined}
			id={confirmationRowId(handle)}
		>
			<td style={cell}>{summary.label}</td>
			<td style={cell}>
				{summary.href ? (
					<a href={summary.href} rel="noreferrer" target="_blank">
						{name}
					</a>
				) : (
					name
				)}
				{summary.title && summary.id ? (
					<span style={styles.muted}> ({summary.id})</span>
				) : null}
				{summary.status ? (
					<span style={styles.status}>{summary.status}</span>
				) : null}
			</td>
			<td style={cell}>
				{summary.permanent ? (
					<span style={styles.permanent}>Permanent</span>
				) : (
					"Moves to trash"
				)}
			</td>
			<td style={cell}>
				{summary.reason ? (
					<span>
						<span style={styles.muted}>The client wrote: </span>
						{summary.reason}
					</span>
				) : (
					<span style={styles.muted}>No reason given</span>
				)}
			</td>
			<td style={cell}>
				<div style={styles.actions}>
					<DecisionButtons
						approve="Approve"
						busy={busy}
						onDecide={(decision) => {
							onDecide([handle], decision);
						}}
						reject="Reject"
						small
					/>
				</div>
			</td>
		</tr>
	);
};

/**
 * The calls of an API key waiting for its user's decision, grouped by tool.
 * Renders nothing when none is waiting.
 */
export const ConfirmationsPanel: React.FC<ConfirmationsPanelProps> = ({
	busy,
	confirmations,
	onDecide,
}) => {
	if (confirmations.length === 0) {
		return null;
	}

	const handles = confirmations.map((confirmation) => confirmation.handle);

	return (
		<section className="field-type" style={styles.panel}>
			<h3 style={styles.heading}>Waiting for your approval</h3>
			<p style={styles.lead}>
				A client using this key asked for these calls. Approving runs nothing:
				the client runs approved calls with runConfirmed. Each call expires 15
				minutes after it was requested.
			</p>
			{groupsOf(confirmations).map(([group, entries]) => (
				<div key={group} style={styles.group}>
					<h4 style={styles.groupHeading}>{group}</h4>
					<table style={styles.table}>
						<thead>
							<tr>
								{HEADS.map((head) => (
									<th key={head} scope="col" style={styles.head}>
										{head}
									</th>
								))}
								<th scope="col" style={styles.head}>
									<span className="sr-only">Decision</span>
								</th>
							</tr>
						</thead>
						<tbody>
							{entries.map((confirmation) => (
								<Row
									busy={busy}
									confirmation={confirmation}
									key={confirmation.handle}
									onDecide={onDecide}
								/>
							))}
						</tbody>
					</table>
				</div>
			))}
			<div style={styles.footer}>
				<DecisionButtons
					approve={approveAllLabel(confirmations)}
					busy={busy}
					onDecide={(decision) => {
						onDecide(handles, decision);
					}}
					reject="Reject all"
				/>
			</div>
		</section>
	);
};
