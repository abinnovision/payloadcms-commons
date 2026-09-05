"use client";

import type { ReactNode } from "react";

/**
 * The one mark viewfinder draws in the admin, shared by the row button and
 * the toggle so the two read as the same feature. Stroke and size come from
 * the button around it, so the icon carries no colour of its own.
 */
export const Crosshair = (props: { slashed?: boolean }): ReactNode => (
	<svg
		aria-hidden
		fill="none"
		height="14"
		stroke="currentColor"
		strokeWidth="1.6"
		viewBox="0 0 16 16"
		width="14"
	>
		<circle cx="8" cy="8" r="3.2" />
		<path d="M8 1v2.2M8 12.8V15M1 8h2.2M12.8 8H15" strokeLinecap="round" />
		{props.slashed ? (
			<path d="M2.5 13.5 13.5 2.5" strokeLinecap="round" />
		) : null}
	</svg>
);
