"use client";

import { createPortal } from "react-dom";

import type { Box } from "./geometry.js";
import type { CSSProperties, ReactNode } from "react";

/** Lets the bridge tell its own chrome apart from the page underneath. */
export const OVERLAY_ATTRIBUTE = "data-vf-overlay";

const ACCENT = "#2d81ff";

const FRAME: CSSProperties = {
	position: "fixed",
	pointerEvents: "none",
	zIndex: 2147483647,
	outline: `2px solid ${ACCENT}`,
	outlineOffset: "1px",
	borderRadius: "2px",
	background: "rgba(45, 129, 255, 0.08)",
	transition:
		"top 80ms linear, left 80ms linear, width 80ms linear, height 80ms linear",
};

/**
 * The only interactive part of the overlay, and the only thing in the page
 * that selects a block. Everything else keeps `pointerEvents: none`, so links
 * and buttons in the previewed page behave exactly as they do for a visitor.
 */
const BADGE: CSSProperties = {
	position: "absolute",
	top: "-1.65em",
	left: 0,
	display: "inline-flex",
	alignItems: "center",
	gap: "0.35em",
	margin: 0,
	padding: "0 0.45em",
	border: 0,
	borderRadius: "2px",
	background: ACCENT,
	color: "#fff",
	font: "500 11px/1.5em ui-sans-serif, system-ui, sans-serif",
	whiteSpace: "nowrap",
	cursor: "pointer",
	pointerEvents: "auto",
};

const LocateIcon = (): ReactNode => (
	<svg
		aria-hidden
		fill="none"
		height="11"
		stroke="currentColor"
		strokeWidth="1.6"
		viewBox="0 0 16 16"
		width="11"
	>
		<circle cx="8" cy="8" r="3.2" />
		<path d="M8 1v2.2M8 12.8V15M1 8h2.2M12.8 8H15" strokeLinecap="round" />
	</svg>
);

export interface OverlayProps {
	box: Box | undefined;
	label: string | undefined;
	onSelect: () => void;
}

/**
 * Portalled to `document.body` so a transformed or clipping ancestor cannot
 * shift the frame away from the block it is outlining — `position: fixed`
 * resolves against the nearest transformed ancestor, not the viewport.
 */
export const Overlay = (props: OverlayProps): ReactNode => {
	if (!props.box || typeof document === "undefined") {
		return null;
	}

	const { top, left, width, height } = props.box;

	return createPortal(
		<div
			{...{ [OVERLAY_ATTRIBUTE]: "" }}
			style={{ ...FRAME, top, left, width, height }}
		>
			<button onClick={props.onSelect} style={BADGE} type="button">
				<LocateIcon />
				{props.label ?? "block"}
			</button>
		</div>,
		document.body,
	);
};
