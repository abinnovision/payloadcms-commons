"use client";

import { useState } from "react";

import type { CSSProperties, ReactNode } from "react";

/**
 * Sized and shaped like Payload's own row controls: `base(1.2)` square with a
 * pill radius, filling with `--theme-elevation-0` on hover the way
 * `.array-actions__button` does. Everything visual comes from Payload's
 * variables, so it follows the active theme rather than sitting on top of it.
 */
const BUTTON: CSSProperties = {
	/*
	 * Payload's collapse toggle is a button stretched over the whole header
	 * (`.collapsible__toggle`, absolute, `width/height: 100%`), and the header
	 * around it sets `pointer-events: none` so that every click reaches the
	 * toggle. Payload's own controls in the header opt back in the same way.
	 *
	 * Both lines are needed. Without the pointer events this button is not
	 * hit-testable at all; without the stacking context the toggle, being
	 * positioned, paints over it. Either one missing and a click collapses the
	 * row instead.
	 */
	pointerEvents: "auto",
	position: "relative",
	zIndex: 1,
	display: "inline-flex",
	alignItems: "center",
	justifyContent: "center",
	flex: "0 0 auto",
	width: "calc(var(--base) * 1.2)",
	height: "calc(var(--base) * 1.2)",
	marginInlineStart: "calc(var(--base) * 0.2)",
	padding: 0,
	border: 0,
	borderRadius: "100px",
	background: "transparent",
	color: "currentcolor",
	cursor: "pointer",
	transition: "opacity 100ms linear, background-color 100ms linear",
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
	const [hovered, setHovered] = useState(false);
	const [focused, setFocused] = useState(false);

	return (
		<button
			aria-label={props.label}
			onBlur={() => {
				setFocused(false);
			}}
			onClick={(event) => {
				/* The header is also the collapse toggle. */
				event.preventDefault();
				event.stopPropagation();
				props.onSelect();
			}}
			onFocus={() => {
				setFocused(true);
			}}
			onMouseEnter={() => {
				setHovered(true);
			}}
			onMouseLeave={() => {
				setHovered(false);
			}}
			style={{
				...BUTTON,
				/* The drag handle beside it sits at the same weight when idle. */
				opacity: hovered || focused ? 1 : 0.5,
				background:
					hovered || focused ? "var(--theme-elevation-0)" : "transparent",
				outline: focused ? "var(--accessibility-outline)" : "none",
				outlineOffset: "var(--accessibility-outline-offset)",
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
