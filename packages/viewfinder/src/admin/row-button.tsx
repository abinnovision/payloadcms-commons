"use client";

import type { CSSProperties, ReactNode } from "react";

const BUTTON: CSSProperties = {
	display: "inline-flex",
	alignItems: "center",
	justifyContent: "center",
	width: "1.5em",
	height: "1.5em",
	marginInlineStart: "0.4em",
	padding: 0,
	border: 0,
	borderRadius: "2px",
	background: "transparent",
	color: "currentcolor",
	opacity: 0.5,
	cursor: "pointer",
};

export interface RowButtonProps {
	label: string;
	onSelect: () => void;
}

/**
 * The admin's half of the explicit affordance: one button per block row,
 * mirroring the badge the preview shows on hover.
 *
 * Portalled into Payload's own row header rather than registered as the
 * block's `Label` component. That slot replaces the whole header fragment,
 * including the block-name input, and only reaches blocks that live in
 * `config.blocks` — inline blocks passed through `blockReferences` would
 * silently get nothing.
 */
export const RowButton = (props: RowButtonProps): ReactNode => (
	<button
		aria-label={props.label}
		onClick={(event) => {
			/* The header is also the collapse toggle. */
			event.preventDefault();
			event.stopPropagation();
			props.onSelect();
		}}
		onMouseEnter={(event) => {
			event.currentTarget.style.opacity = "1";
		}}
		onMouseLeave={(event) => {
			event.currentTarget.style.opacity = "0.5";
		}}
		style={BUTTON}
		title={props.label}
		type="button"
	>
		<svg
			aria-hidden
			fill="none"
			height="12"
			stroke="currentColor"
			strokeWidth="1.6"
			viewBox="0 0 16 16"
			width="12"
		>
			<circle cx="8" cy="8" r="3.2" />
			<path d="M8 1v2.2M8 12.8V15M1 8h2.2M12.8 8H15" strokeLinecap="round" />
		</svg>
	</button>
);
