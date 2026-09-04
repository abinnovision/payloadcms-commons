"use client";

import { createPortal } from "react-dom";

import type { Box } from "./geometry.js";
import type { CSSProperties, ReactNode } from "react";

const FRAME: CSSProperties = {
	position: "fixed",
	pointerEvents: "none",
	zIndex: 2147483647,
	outline: "2px solid #2d81ff",
	outlineOffset: "1px",
	borderRadius: "2px",
	background: "rgba(45, 129, 255, 0.08)",
	transition:
		"top 80ms linear, left 80ms linear, width 80ms linear, height 80ms linear",
};

const LABEL: CSSProperties = {
	position: "absolute",
	top: "-1.5em",
	left: 0,
	padding: "0 0.4em",
	borderRadius: "2px",
	background: "#2d81ff",
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
		<div aria-hidden style={{ ...FRAME, top, left, width, height }}>
			{props.label ? <span style={LABEL}>{props.label}</span> : null}
		</div>,
		document.body,
	);
};
