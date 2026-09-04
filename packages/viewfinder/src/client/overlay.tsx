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
 * Names the block being pointed at. Inert on purpose: the block itself is the
 * click target, so a badge that took pointer events would only carve a dead
 * spot out of it.
 */
const BADGE: CSSProperties = {
	position: "absolute",
	top: "-1.65em",
	left: 0,
	display: "inline-flex",
	alignItems: "center",
	gap: "0.35em",
	padding: "0 0.45em",
	borderRadius: "2px",
	background: ACCENT,
	color: "#fff",
	font: "500 11px/1.5em ui-sans-serif, system-ui, sans-serif",
	whiteSpace: "nowrap",
};

export interface OverlayProps {
	box: Box | undefined;
	label: string | undefined;
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
			<span style={BADGE}>{props.label ?? "block"}</span>
		</div>,
		document.body,
	);
};
