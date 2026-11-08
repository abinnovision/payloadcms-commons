"use client";

import { CircledXIcon, SpinnerIcon } from "@payloadcms/ui";
import React from "react";

import { rowTime } from "./date-buckets.js";

import type { AgentSummary } from "./api.js";

/** What a row shows of its thread. */
export interface RowFacts {
	unread: boolean;
	running: boolean;
	failed: boolean;
	lastMessageAt?: Date | undefined;
	/** A second line, such as the agent and kind of a run. */
	meta?: string | undefined;
}

/** The agent's label, or its slug without one. */
export const agentLabel = (
	agents: readonly AgentSummary[],
	slug: string,
): string => agents.find((entry) => entry.slug === slug)?.label ?? slug;

/** The second line of a run: its agent and how it started. */
export const runMeta = (
	agentLabel: string,
	kind: string | undefined,
): string | undefined => {
	if (kind === "ambient") {
		return `${agentLabel} · Scheduled`;
	}

	return kind === "reactive" ? `${agentLabel} · Triggered` : undefined;
};

/*
 * The leading slot: running, failed or unread, in that order. The glyph is
 * decorative; the state is read out as text.
 */
const RowStatus: React.FC<Omit<RowFacts, "lastMessageAt" | "meta">> = ({
	unread,
	running,
	failed,
}) => {
	const states = [
		running ? "Running" : undefined,
		failed ? "Failed" : undefined,
		unread ? "Unread" : undefined,
	].filter((state) => state !== undefined);

	return (
		<span className="flue-row__status">
			<span aria-hidden="true" className="flue-row__glyph">
				{running ? (
					<SpinnerIcon size="sm" />
				) : failed ? (
					<span className="flue-row__failed">
						<CircledXIcon />
					</span>
				) : unread ? (
					<span className="flue-row__unread" />
				) : null}
			</span>
			{states.length === 0 ? null : (
				<span className="flue-visually-hidden">{`${states.join(", ")}. `}</span>
			)}
		</span>
	);
};

/**
 * The inside of a thread row's button: status, title, an optional second
 * line and the time of the last message. Shared by the runtime's chats and
 * the search and runs panes.
 */
export const RowBody: React.FC<
	RowFacts & { title: React.ReactNode; now: Date }
> = ({ title, now, lastMessageAt, meta, ...status }) => (
	<>
		<RowStatus {...status} />
		<span className="flue-row__text">
			<span className="flue-row__title">{title}</span>
			{meta === undefined ? null : (
				<span className="flue-row__meta">{meta}</span>
			)}
		</span>
		{lastMessageAt === undefined ? null : (
			<time className="flue-row__time" dateTime={lastMessageAt.toISOString()}>
				{rowTime(lastMessageAt, now)}
			</time>
		)}
	</>
);
