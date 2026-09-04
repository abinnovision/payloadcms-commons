"use client";

import { useState } from "react";

import type { CSSProperties, ReactNode } from "react";

const ACCENT = "#2d81ff";

const BUTTON: CSSProperties = {
	display: "inline-flex",
	alignItems: "center",
	justifyContent: "center",
	flex: "0 0 auto",
	width: "24px",
	height: "24px",
	marginInlineStart: "0.4em",
	padding: 0,
	border: 0,
	borderRadius: "3px",
	background: "transparent",
	color: "currentcolor",
	cursor: "pointer",
};

export interface RowButtonProps {
	label: string;
	onSelect: () => void;
}

/**
 * The admin's half of the addressing UI: one button per block row, which
 * sends the preview to that block.
 *
 * Portalled into Payload's own row header rather than registered as the
 * block's `Label` component. That slot replaces the whole header fragment,
 * including the block-name input, and only reaches blocks that live in
 * `config.blocks` — inline blocks passed through `blockReferences` would
 * silently get nothing.
 */
export const RowButton = (props: RowButtonProps): ReactNode => {
	const [lit, setLit] = useState(false);

	return (
		<button
			aria-label={props.label}
			onBlur={() => {
				setLit(false);
			}}
			onClick={(event) => {
				/* The header is also the collapse toggle. */
				event.preventDefault();
				event.stopPropagation();
				props.onSelect();
			}}
			onFocus={() => {
				setLit(true);
			}}
			onMouseEnter={() => {
				setLit(true);
			}}
			onMouseLeave={() => {
				setLit(false);
			}}
			style={{
				...BUTTON,
				opacity: lit ? 1 : 0.65,
				background: lit ? "rgba(45, 129, 255, 0.12)" : "transparent",
				color: lit ? ACCENT : "currentcolor",
				outline: lit ? `1px solid rgba(45, 129, 255, 0.4)` : "none",
			}}
			title={props.label}
			type="button"
		>
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
			</svg>
		</button>
	);
};
