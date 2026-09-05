"use client";

import { useState } from "react";

import { Crosshair } from "./icons.js";

import type { CSSProperties, ReactNode } from "react";

/**
 * Sized and shaped like Payload's own row controls, which it sits beside:
 * `base(1.2)` square with a pill radius, filling with `--theme-elevation-0`
 * on hover the way `.array-actions__button` does. Everything visual comes
 * from Payload's variables, so it follows the active theme rather than
 * sitting on top of it.
 */
const BUTTON: CSSProperties = {
	/*
	 * Payload's collapse toggle is a button stretched over the whole header
	 * (`.collapsible__toggle`, absolute, `width/height: 100%`), and the cluster
	 * around this one sets `pointer-events: none` so that every click reaches
	 * the toggle. Payload's own controls in the cluster opt back in the same
	 * way.
	 *
	 * Both lines are needed. Without the pointer events this button is not
	 * hit-testable at all; without the stacking context the toggle, being
	 * positioned, paints over it. Either one missing and a click collapses the
	 * row instead.
	 */
	pointerEvents: "auto",
	position: "relative",
	zIndex: 1,
	/* The cluster is a flex row, and this belongs before the row menu. */
	order: -1,
	display: "inline-flex",
	alignItems: "center",
	justifyContent: "center",
	flex: "0 0 auto",
	width: "calc(var(--base) * 1.2)",
	height: "calc(var(--base) * 1.2)",
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
 * Portalled into Payload's own row controls, beside the row menu and the
 * collapse chevron, rather than registered as the block's `Label` component.
 * That slot replaces the whole header fragment, including the block-name
 * input, and only reaches blocks that live in `config.blocks` — inline blocks
 * passed through `blockReferences` would silently get nothing.
 */
export const RowButton = (props: RowButtonProps): ReactNode => {
	const [hovered, setHovered] = useState(false);
	const [keyboardFocus, setKeyboardFocus] = useState(false);

	return (
		<button
			aria-label={props.label}
			onBlur={() => {
				setKeyboardFocus(false);
			}}
			onClick={(event) => {
				/* The header is also the collapse toggle. */
				event.preventDefault();
				event.stopPropagation();
				props.onSelect();
			}}
			onFocus={(event) => {
				/*
				 * `:focus-visible` rather than focus, so that clicking does not
				 * leave a ring behind. Payload's own controls are styled the same
				 * way, through the global `:focus-visible` rule.
				 */
				setKeyboardFocus(event.currentTarget.matches(":focus-visible"));
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
				opacity: hovered || keyboardFocus ? 1 : 0.5,
				background:
					hovered || keyboardFocus ? "var(--theme-elevation-0)" : "transparent",
				outline: keyboardFocus ? "var(--accessibility-outline)" : "none",
				outlineOffset: "var(--accessibility-outline-offset)",
			}}
			title={props.label}
			type="button"
		>
			<Crosshair />
		</button>
	);
};
