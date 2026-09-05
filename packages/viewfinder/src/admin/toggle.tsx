"use client";

import { Button } from "@payloadcms/ui";

import { Crosshair } from "./icons.js";

import type { CSSProperties, ReactNode } from "react";

/**
 * The same box in both states, because it is the box Payload's live-preview
 * toggler already draws beside it: `subtle` resolves to `--theme-elevation-100`
 * on `--theme-elevation-200`, which is that button exactly. State is carried by
 * the icon, as it is on the toggler, whose eye slashes rather than reboxing.
 *
 * Not `secondary`, which is the one that looks wrong here: its border is
 * `--theme-elevation-800`, so an outlined icon button lands as a black square
 * next to Payload's grey ones.
 */
const STYLE = "subtle";

/**
 * `Button`'s own sizes are shaped for a label, so an icon-only one comes out a
 * squat rectangle. These are the toggler's own dimensions, in the toggler's own
 * units, which is what makes the two read as one pair of square icon buttons
 * rather than a square beside an oblong.
 */
const SQUARE: CSSProperties = {
	width: "calc(var(--base) * 1.6)",
	height: "calc(var(--base) * 1.6)",
	padding: 0,
	display: "inline-flex",
	alignItems: "center",
	justifyContent: "center",
};

const LABEL = {
	on: "Stop linking the preview and this form",
	off: "Link the preview and this form",
	idle: "Open the live preview to link it to this form",
} as const;

export interface ViewfinderToggleProps {
	/** True while there is no live preview to link to, or the setting is still loading. */
	disabled: boolean;
	enabled: boolean;
	onToggle: (enabled: boolean) => void;
}

/**
 * The one control for the whole feature. Off means no outlines in either
 * direction, no row buttons, and no click interception in the preview, so an
 * editor can click through the previewed site the way a visitor would.
 *
 * Built on Payload's own `Button` rather than a styled `<button>`, so the
 * hover, focus and disabled states are the admin's rather than an imitation of
 * them, and stay right through a theme or a Payload upgrade.
 */
export const ViewfinderToggle = (props: ViewfinderToggleProps): ReactNode => {
	const label = props.disabled
		? LABEL.idle
		: props.enabled
			? LABEL.on
			: LABEL.off;

	return (
		<Button
			aria-label={label}
			buttonStyle={STYLE}
			disabled={props.disabled}
			/* Not a Button prop, but the state a toggle owes a screen reader. */
			extraButtonProps={{ "aria-pressed": props.enabled, style: SQUARE }}
			icon={<Crosshair slashed={!props.enabled} />}
			margin={false}
			onClick={() => {
				props.onToggle(!props.enabled);
			}}
			size="small"
			tooltip={label}
		/>
	);
};
